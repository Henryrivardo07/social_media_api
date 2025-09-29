const router = require("express").Router();
const { body } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * tags:
 *   - name: My Profile
 *     description: My profile & identity
 */

/**
 * @swagger
 * /api/me:
 *   get:
 *     summary: Get my profile + quick stats
 *     tags: [My Profile]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // profil dasar
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        bio: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!me) return errorResponse(res, "User not found", 404);

    // stats cepat (MVP):
    // - posts: jumlah post yang dibuat user
    // - followers: jumlah orang yang follow user ini
    // - following: jumlah orang yang difollow user ini
    // - likes: total likes yang diterima di semua post user
    const [posts, followers, following, likesAgg] = await Promise.all([
      prisma.post.count({ where: { userId } }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.like.count({
        where: { post: { userId } }, // like pada post yang dimiliki user
      }),
    ]);

    return successResponse(res, {
      profile: me,
      stats: { posts, followers, following, likes: likesAgg },
    });
  } catch (e) {
    console.error("GET /api/me error:", e);
    return errorResponse(res);
  }
});

/**
 * @swagger
 * /api/me:
 *   patch:
 *     summary: Update my basic profile
 *     tags: [My Profile]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               username: { type: string }
 *               phone: { type: string }
 *               bio: { type: string }
 *               avatarUrl: { type: string, description: "Public image URL (MVP)" }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Validation / duplicate username/email }
 */
router.patch(
  "/",
  authenticateToken,
  [
    body("name").optional().isString().isLength({ min: 2 }).trim(),
    body("username").optional().isString().isLength({ min: 3 }).trim(),
    body("phone").optional().isString().trim(),
    body("bio").optional().isString().isLength({ max: 300 }).trim(),
    body("avatarUrl").optional().isURL().withMessage("avatarUrl must be URL"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, username, phone, bio, avatarUrl } = req.body;

      // Jika update username → pastikan unik (selain dirinya sendiri)
      if (username) {
        const exists = await prisma.user.findFirst({
          where: { username, NOT: { id: userId } },
          select: { id: true },
        });
        if (exists) return errorResponse(res, "Username already in use", 400);
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { name, username, phone, bio, avatarUrl },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          bio: true,
          avatarUrl: true,
          updatedAt: true,
        },
      });

      return successResponse(res, updated, "Profile updated");
    } catch (e) {
      console.error("PATCH /api/me error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

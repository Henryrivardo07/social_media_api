const router = require("express").Router();
const { param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * tags:
 *   - name: Saves
 *     description: Simpan (bookmark) postingan
 */

/**
 * @swagger
 * /api/posts/{id}/save:
 *   post:
 *     summary: Save a post (bookmark)
 *     tags: [Saves]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Saved }
 *       404: { description: Post not found }
 */
router.post(
  "/posts/:id/save",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const postId = Number(req.params.id);

    try {
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (!post) return errorResponse(res, "Post not found", 404);

      await prisma.save.upsert({
        where: { userId_postId: { userId, postId } },
        update: {},
        create: { userId, postId },
      });

      return successResponse(res, { saved: true }, "Saved");
    } catch (e) {
      console.error("Save post error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/posts/{id}/save:
 *   delete:
 *     summary: Unsave a post
 *     tags: [Saves]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Unsaved }
 *       404: { description: Post not found }
 */
router.delete(
  "/posts/:id/save",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const postId = Number(req.params.id);

    try {
      await prisma.save.deleteMany({ where: { userId, postId } });
      return successResponse(res, { saved: false }, "Unsaved");
    } catch (e) {
      console.error("Unsave post error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/me/saved:
 *   get:
 *     summary: Get my saved posts
 *     tags: [Saves]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 */
router.get(
  "/me/saved",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    try {
      const [rows, total] = await Promise.all([
        prisma.save.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            post: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    name: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        }),
        prisma.save.count({ where: { userId } }),
      ]);

      const posts = rows.map((r) => ({
        id: r.post.id,
        imageUrl: r.post.imageUrl,
        caption: r.post.caption,
        createdAt: r.post.createdAt,
        author: r.post.author,
      }));

      return successResponse(res, {
        posts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error("Get saved posts error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

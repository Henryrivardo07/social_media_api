// src/routes/feed.js
const router = require("express").Router();
const { query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// helper sama kayak posts
const toPostSummary = (p, meId) => ({
  id: p.id,
  imageUrl: p.imageUrl,
  caption: p.caption,
  createdAt: p.createdAt,
  author: p.user && {
    id: p.user.id,
    username: p.user.username,
    name: p.user.name,
    avatarUrl: p.user.avatarUrl,
  },
  likeCount: p._count?.likes ?? 0,
  commentCount: p._count?.comments ?? 0,
  likedByMe: !!p.likedByMe,
});

/**
 * @swagger
 * tags:
 *   - name: Feed
 *     description: Timeline feed (self + following)
 */

/**
 * @swagger
 * /api/feed:
 *   get:
 *     summary: Timeline posts (self + following)
 *     tags: [Feed]
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
  "/feed",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const meId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      // ambil id user yang di-follow + diri sendiri
      const following = await prisma.follow.findMany({
        where: { followerId: meId },
        select: { followingId: true },
      });
      const ids = [meId, ...following.map((f) => f.followingId)];

      // ambil posts
      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: { userId: { in: ids } },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            user: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
            _count: { select: { likes: true, comments: true } },
            likes: { where: { userId: meId }, select: { userId: true } },
          },
        }),
        prisma.post.count({ where: { userId: { in: ids } } }),
      ]);

      const items = posts.map((p) =>
        toPostSummary({ ...p, likedByMe: p.likes?.length > 0 }, meId)
      );

      return successResponse(res, {
        items,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error("Feed error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

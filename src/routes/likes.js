const router = require("express").Router();
const { param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * tags:
 *   - name: Likes
 *     description: Like/Unlike post dan daftar "Liked" milik user
 */

/**
 * Helper: ubah record Like -> post summary ringkas
 */
function toPostSummaryFromLike(likeRow, likedByViewer) {
  const p = likeRow.post;
  if (!p) return null;
  return {
    id: p.id,
    imageUrl: p.imageUrl,
    caption: p.caption,
    createdAt: p.createdAt,
    likedAt: likeRow.createdAt,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe: !!likedByViewer,
    author: {
      id: p.user.id,
      username: p.user.username,
      name: p.user.name,
      avatarUrl: p.user.avatarUrl,
    },
  };
}

/**
 * @swagger
 * /api/posts/{id}/like:
 *   post:
 *     summary: Like a post (idempotent)
 *     tags: [Likes]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Liked }
 *       404: { description: Post not found }
 */
router.post(
  "/posts/:id/like",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const postId = Number(req.params.id);
    try {
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (!post) return errorResponse(res, "Post not found", 404);

      // sudah like?
      const exists = await prisma.like.findUnique({
        where: { userId_postId: { userId, postId } },
      });
      if (exists) {
        return successResponse(
          res,
          { liked: true, likeCount: post.likeCount },
          "Already liked"
        );
      }

      // transaksi: create like + increment counter
      const updated = await prisma.$transaction(async (tx) => {
        await tx.like.create({ data: { userId, postId } });
        const up = await tx.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
          select: { likeCount: true },
        });
        return up.likeCount;
      });

      return successResponse(res, { liked: true, likeCount: updated }, "Liked");
    } catch (e) {
      console.error("Like error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/posts/{id}/like:
 *   delete:
 *     summary: Unlike a post (idempotent)
 *     tags: [Likes]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Unliked }
 *       404: { description: Post not found }
 */
router.delete(
  "/posts/:id/like",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const postId = Number(req.params.id);
    try {
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (!post) return errorResponse(res, "Post not found", 404);

      const exists = await prisma.like.findUnique({
        where: { userId_postId: { userId, postId } },
      });
      if (!exists) {
        return successResponse(
          res,
          { liked: false, likeCount: post.likeCount },
          "Already unliked"
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.like.delete({
          where: { userId_postId: { userId, postId } },
        });
        const up = await tx.post.update({
          where: { id: postId },
          data: {
            likeCount: post.likeCount > 0 ? { decrement: 1 } : undefined,
          },
          select: { likeCount: true },
        });
        return up.likeCount;
      });

      return successResponse(
        res,
        { liked: false, likeCount: updated },
        "Unliked"
      );
    } catch (e) {
      console.error("Unlike error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/posts/{id}/likes:
 *   get:
 *     summary: List users who liked a post
 *     tags: [Likes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Post not found }
 */
router.get(
  "/posts/:id/likes",
  [
    param("id").isInt({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const postId = Number(req.params.id);
    const { page = 1, limit = 20 } = req.query;
    try {
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (!post) return errorResponse(res, "Post not found", 404);

      const [items, total] = await Promise.all([
        prisma.like.findMany({
          where: { postId },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            user: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        }),
        prisma.like.count({ where: { postId } }),
      ]);

      return successResponse(res, {
        users: items.map((l) => ({ ...l.user })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/users/{username}/likes:
 *   get:
 *     summary: Get posts liked by a user (public tab "Liked")
 *     tags: [Likes]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 *       404: { description: User not found }
 */
router.get(
  "/users/:username/likes",
  [
    param("username").isString(),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;

    try {
      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (!user) return errorResponse(res, "User not found", 404);

      const [likes, total] = await Promise.all([
        prisma.like.findMany({
          where: { userId: user.id },
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
        prisma.like.count({ where: { userId: user.id } }),
      ]);

      const posts = likes
        .map((row) => toPostSummaryFromLike(row, false))
        .filter(Boolean);

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
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/me/likes:
 *   get:
 *     summary: Get posts I liked
 *     tags: [Likes]
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
  "/me/likes",
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
      const [likes, total] = await Promise.all([
        prisma.like.findMany({
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
        prisma.like.count({ where: { userId } }),
      ]);

      const posts = likes
        .map((row) => toPostSummaryFromLike(row, true))
        .filter(Boolean);

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
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

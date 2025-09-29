// src/routes/comments.js
const router = require("express").Router();
const { param, body, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// Helper update counter
async function safeSetPostCommentCount(tx, postId, count) {
  try {
    await tx.post.update({
      where: { id: postId },
      data: { commentCount: count },
    });
  } catch (_) {
    // kalau kolom commentCount belum ada di skema → abaikan
  }
}

/**
 * @swagger
 * tags:
 *   - name: Comments
 *     description: Comment operations
 */

/**
 * @swagger
 * /api/posts/{id}/comments:
 *   get:
 *     summary: List comments of a post
 *     tags: [Comments]
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
 *         schema: { type: integer, default: 10, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 */
router.get(
  "/posts/:id/comments",
  [
    param("id").isInt({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const { page = 1, limit = 10 } = req.query;

      const [comments, total] = await Promise.all([
        prisma.comment.findMany({
          where: { postId },
          include: {
            user: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
        }),
        prisma.comment.count({ where: { postId } }),
      ]);

      return successResponse(res, {
        comments: comments.map((c) => ({
          id: c.id,
          text: c.content, // ← map dari kolom content
          createdAt: c.createdAt,
          author: c.user,
          isMine: req.user && req.user.id === c.userId,
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error("Get comments error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/posts/{id}/comments:
 *   post:
 *     summary: Add a comment
 *     tags: [Comments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Post ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text: { type: string, example: "Nice post!" }
 *     responses:
 *       201: { description: Comment created }
 *       401: { description: Unauthorized }
 *       404: { description: Post not found }
 */
router.post(
  "/posts/:id/comments",
  authenticateToken,
  [
    param("id").isInt({ min: 1 }),
    body("text").isString().trim().isLength({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const userId = req.user.id;
      const { text } = req.body;

      // Pastikan post ada
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { id: true },
      });
      if (!post) return errorResponse(res, "Post not found", 404);

      const created = await prisma.$transaction(async (tx) => {
        // Simpan ke kolom `content`
        const c = await tx.comment.create({
          data: { postId, userId, content: text },
          select: {
            id: true,
            postId: true,
            userId: true,
            content: true,
            createdAt: true,
          },
        });

        // Hitung ulang jumlah komentar
        const count = await tx.comment.count({ where: { postId } });
        await safeSetPostCommentCount(tx, postId, count);

        return c;
      });

      // Ambil author untuk response
      const author = await prisma.user.findUnique({
        where: { id: created.userId },
        select: { id: true, username: true, name: true, avatarUrl: true },
      });

      return successResponse(
        res,
        {
          id: created.id,
          text: created.content, // ← kembalikan sebagai text
          createdAt: created.createdAt,
          author,
          isMine: true,
        },
        "Comment created",
        201
      );
    } catch (e) {
      console.error("Create comment error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/comments/{id}:
 *   delete:
 *     summary: Delete a comment (only owner)
 *     tags: [Comments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.delete(
  "/comments/:id",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const id = Number(req.params.id);

      const comment = await prisma.comment.findUnique({ where: { id } });
      if (!comment) return errorResponse(res, "Comment not found", 404);
      if (comment.userId !== userId)
        return errorResponse(res, "Forbidden", 403);

      await prisma.$transaction(async (tx) => {
        await tx.comment.delete({ where: { id } });
        const count = await tx.comment.count({
          where: { postId: comment.postId },
        });
        await safeSetPostCommentCount(tx, comment.postId, count);
      });

      return successResponse(res, { deleted: true }, "Comment deleted");
    } catch (e) {
      console.error("Delete comment error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

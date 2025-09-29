// src/routes/posts.js
const router = require("express").Router();
const { body, param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// helper: bentuk ringkas post
const toPostSummary = (p, meId) => ({
  id: p.id,
  imageUrl: p.imageUrl,
  caption: p.caption,
  createdAt: p.createdAt,
  author: p.author && {
    id: p.author.id,
    username: p.author.username,
    name: p.author.name,
    avatarUrl: p.author.avatarUrl,
  },
  likeCount: p._count?.likes ?? 0,
  commentCount: p._count?.comments ?? 0,
  likedByMe: !!p.likedByMe,
});

/**
 * @swagger
 * tags:
 *   - name: Posts
 *     description: Create, read, delete posts
 */

/**
 * @swagger
 * /api/posts:
 *   post:
 *     summary: Create a post (1 image + caption)
 *     tags: [Posts]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [imageUrl]
 *             properties:
 *               imageUrl: { type: string, example: "https://cdn.example.com/img.jpg" }
 *               caption:  { type: string, example: "Hello world!" }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Bad Request }
 *       401: { description: Unauthorized }
 */
router.post(
  "/posts",
  authenticateToken,
  [
    body("imageUrl").isURL(),
    body("caption").optional().isString().isLength({ max: 1000 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { imageUrl, caption } = req.body;

      const post = await prisma.post.create({
        data: { userId, imageUrl, caption },
        include: {
          user: {
            // ⬅️ was 'author'
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
          _count: { select: { likes: true, comments: true } },
        },
      });

      // Bentuk response (tetap expose 'author' untuk FE)
      return successResponse(
        res,
        {
          id: post.id,
          imageUrl: post.imageUrl,
          caption: post.caption,
          createdAt: post.createdAt,
          author: {
            // map dari 'user'
            id: post.user.id,
            username: post.user.username,
            name: post.user.name,
            avatarUrl: post.user.avatarUrl,
          },
          likeCount: post._count.likes,
          commentCount: post._count.comments,
          likedByMe: false,
        },
        "Created",
        201
      );
    } catch (e) {
      console.error("Create post error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/posts/{id}:
 *   get:
 *     summary: Get post detail
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
router.get(
  "/posts/:id",
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const meId = req.user?.id || 0; // boleh tanpa auth
      const id = Number(req.params.id);

      const post = await prisma.post.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
          _count: { select: { likes: true, comments: true } },
          likes: meId
            ? { where: { userId: meId }, select: { userId: true } }
            : false,
        },
      });
      if (!post) return errorResponse(res, "Post not found", 404);

      const likedByMe = meId ? post.likes?.length > 0 : false;
      const shaped = toPostSummary({ ...post, likedByMe }, meId);
      return successResponse(res, shaped);
    } catch (e) {
      console.error("Get post error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/posts/{id}:
 *   delete:
 *     summary: Delete my own post
 *     tags: [Posts]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.delete(
  "/posts/:id",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const meId = req.user.id;
      const id = Number(req.params.id);

      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, userId: true },
      });
      if (!post) return errorResponse(res, "Post not found", 404);
      if (post.userId !== meId) return errorResponse(res, "Forbidden", 403);

      await prisma.post.delete({ where: { id } });
      return successResponse(res, { deleted: true }, "Deleted");
    } catch (e) {
      console.error("Delete post error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/users/{username}/posts:
 *   get:
 *     summary: List posts by username (public)
 *     tags: [Posts]
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
  "/users/:username/posts",
  [
    param("username").isString(),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const meId = req.user?.id || 0; // boleh tanpa auth
      const { username } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) return errorResponse(res, "User not found", 404);

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            author: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
            _count: { select: { likes: true, comments: true } },
            likes: meId
              ? { where: { userId: meId }, select: { userId: true } }
              : false,
          },
        }),
        prisma.post.count({ where: { userId: user.id } }),
      ]);

      const items = posts.map((p) =>
        toPostSummary(
          { ...p, likedByMe: meId ? p.likes?.length > 0 : false },
          meId
        )
      );

      return successResponse(res, {
        posts: items,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error("List user posts error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

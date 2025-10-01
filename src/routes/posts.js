// src/routes/posts.js
const router = require("express").Router();
const { param, query, body } = require("express-validator");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// Multer: simpan di memori supaya bisa langsung di-stream ke Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

// Helper Cloudinary upload
function uploadToCloudinary(fileBuffer, folder = "posts") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

// Helper: bentuk ringkas post
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
 *   - name: Posts
 *     description: Upload & manage posts
 */

/**
 * @swagger
 * /api/posts:
 *   post:
 *     summary: Create a post (upload file + caption)
 *     tags: [Posts]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *               caption:
 *                 type: string
 *     responses:
 *       201: { description: Created }
 *       400: { description: Bad Request }
 *       401: { description: Unauthorized }
 */
router.post(
  "/posts",
  authenticateToken,
  upload.single("image"),
  [body("caption").optional().isString().isLength({ max: 1000 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      if (!req.file) return errorResponse(res, "Image is required", 400);

      const uploadRes = await uploadToCloudinary(req.file.buffer, "posts");

      const post = await prisma.post.create({
        data: {
          userId: req.user.id,
          imageUrl: uploadRes.secure_url,
          caption: req.body.caption || null,
        },
        include: {
          user: {
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
          _count: { select: { likes: true, comments: true } },
        },
      });

      return successResponse(
        res,
        {
          id: post.id,
          imageUrl: post.imageUrl,
          caption: post.caption,
          createdAt: post.createdAt,
          author: {
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
      return errorResponse(res, "Upload failed");
    }
  }
);

/**
 * GET detail post
 */
router.get(
  "/posts/:id",
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const meId = req.user?.id || 0;
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
      return successResponse(res, toPostSummary({ ...post, likedByMe }, meId));
    } catch (e) {
      console.error("Get post error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * DELETE my post
 */
router.delete(
  "/posts/:id",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const post = await prisma.post.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!post) return errorResponse(res, "Post not found", 404);
      if (post.userId !== req.user.id)
        return errorResponse(res, "Forbidden", 403);

      await prisma.post.delete({ where: { id } });
      return successResponse(res, { deleted: true }, "Deleted");
    } catch (e) {
      console.error("Delete post error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

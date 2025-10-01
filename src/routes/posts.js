// src/routes/posts.js
const router = require("express").Router();
const { body, param, query } = require("express-validator");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/* ===== Cloudinary config (gunakan CLOUDINARY_URL atau 3 var terpisah) ===== */
if (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/* ===== Multer (in-memory) ===== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp";
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

/* ===== Helper: upload ke Cloudinary via stream ===== */
function uploadToCloudinary(fileBuffer, folder = "posts") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

/* ===== Helper: bentuk ringkas post ===== */
const toPostSummary = (p, likedByMe = false) => ({
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
  likedByMe: !!likedByMe,
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
 *     summary: Create a post (upload image + caption)
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
 *                 description: JPG/PNG/WEBP (max 5MB)
 *               caption:
 *                 type: string
 *                 example: "Hello world!"
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

      return successResponse(res, toPostSummary(post, false), "Created", 201);
    } catch (e) {
      console.error("Create post error:", e);
      return errorResponse(
        res,
        e.message?.includes("Only JPG/PNG/WEBP") ? e.message : "Upload failed"
      );
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
      const meId = req.user?.id || 0; // optional auth (kalau ada bearer)
      const id = Number(req.params.id);

      const post = await prisma.post.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
          _count: { select: { likes: true, comments: true } },
          ...(meId && {
            likes: { where: { userId: meId }, select: { userId: true } },
          }),
        },
      });
      if (!post) return errorResponse(res, "Post not found", 404);

      const likedByMe = meId ? post.likes?.length > 0 : false;
      return successResponse(res, toPostSummary(post, likedByMe));
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
      const id = Number(req.params.id);

      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, userId: true },
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
      const meId = req.user?.id || 0; // optional auth
      const { username } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) return errorResponse(res, "User not found", 404);

      const [rows, total] = await Promise.all([
        prisma.post.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            user: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
            _count: { select: { likes: true, comments: true } },
            ...(meId && {
              likes: { where: { userId: meId }, select: { userId: true } },
            }),
          },
        }),
        prisma.post.count({ where: { userId: user.id } }),
      ]);

      const posts = rows.map((p) =>
        toPostSummary(p, meId ? p.likes?.length > 0 : false)
      );

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
      console.error("List user posts error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

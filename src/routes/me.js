// src/routes/me.js
const router = require("express").Router();
const { body } = require("express-validator");
const multer = require("multer");
const streamifier = require("streamifier");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// --- Cloudinary ---
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- Multer (memory) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/webp";
    if (!ok) return cb(new Error("Only PNG/JPG/WEBP are allowed"));
    cb(null, true);
  },
});

// --- helper upload buffer -> Cloudinary ---
function uploadBufferToCloudinary(buffer, folder = "sociality/avatars") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

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
 *       200: { description: OK }
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

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

    const [posts, followers, following, likesAgg] = await Promise.all([
      prisma.post.count({ where: { userId } }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.like.count({ where: { post: { userId } } }),
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
 *     summary: Update my basic profile (supports avatar upload)
 *     tags: [My Profile]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               username: { type: string }
 *               phone: { type: string }
 *               bio: { type: string }
 *               avatar: { type: string, format: binary, description: "PNG/JPG/WEBP max 5MB" }
 *               avatarUrl: { type: string, description: "Alternative public URL if not uploading file" }
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               username: { type: string }
 *               phone: { type: string }
 *               bio: { type: string }
 *               avatarUrl: { type: string, description: "Public image URL" }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Validation / duplicate username }
 */
router.patch(
  "/",
  authenticateToken,
  // NOTE: validasi ringan; avatar dikirim via file → kita nggak validate di sini
  [
    body("name").optional().isString().isLength({ min: 2 }).trim(),
    body("username").optional().isString().isLength({ min: 3 }).trim(),
    body("phone").optional().isString().trim(),
    body("bio").optional().isString().isLength({ max: 300 }).trim(),
    body("avatarUrl").optional().isURL().withMessage("avatarUrl must be URL"),
  ],
  handleValidationErrors,
  upload.single("avatar"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, username, phone, bio } = req.body;
      let { avatarUrl } = req.body; // boleh null/undefined

      // Unik username (kalau di-update)
      if (username) {
        const exists = await prisma.user.findFirst({
          where: { username, NOT: { id: userId } },
          select: { id: true },
        });
        if (exists) return errorResponse(res, "Username already in use", 400);
      }

      // Kalau ada file avatar → upload ke Cloudinary, override avatarUrl
      if (req.file && req.file.buffer) {
        try {
          const result = await uploadBufferToCloudinary(
            req.file.buffer,
            "sociality/avatars"
          );
          avatarUrl = result.secure_url;
        } catch (err) {
          console.error("Cloudinary upload error:", err);
          return errorResponse(res, "Failed to upload avatar", 400);
        }
      }

      const dataToUpdate = {
        ...(name !== undefined && { name }),
        ...(username !== undefined && { username }),
        ...(phone !== undefined && { phone }),
        ...(bio !== undefined && { bio }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      };

      const updated = await prisma.user.update({
        where: { id: userId },
        data: dataToUpdate,
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

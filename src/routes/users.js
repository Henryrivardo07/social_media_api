// src/routes/users.js
const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/** ===== helper: optional auth (jika ada token, set req.user; jika tidak, lanjut publik) ===== */
function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id }
  } catch {}
  next();
}

/** ===== helper: ringkas post ===== */
const postSummary = (p, viewerId) => ({
  id: p.id,
  imageUrl: p.imageUrl,
  caption: p.caption,
  createdAt: p.createdAt,
  author: p.user
    ? {
        id: p.user.id,
        username: p.user.username,
        name: p.user.name,
        avatarUrl: p.user.avatarUrl,
      }
    : undefined,
  likeCount: p._count?.likes ?? 0,
  commentCount: p._count?.comments ?? 0,
  likedByMe: !!p.likes?.length && !!viewerId,
});

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: Public user profile & listings
 */

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     tags: [Users]
 *     summary: Search users by name/username
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 1 }
 *         description: Keyword untuk name atau username
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: List users
 */
router.get(
  "/search",
  optionalAuth,
  [
    query("q").isString().trim().isLength({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // normalisasi input
      const rawQ = String(req.query.q || "").trim();
      const q = rawQ.replace(/\s+/g, " ");
      const page = Number(req.query.page || 1);
      const limit = Math.min(Number(req.query.limit || 20), 50);
      const viewerId = req.user?.id;

      const where = {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      };

      const [rows, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: { id: true, username: true, name: true, avatarUrl: true },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ username: "asc" }],
        }),
        prisma.user.count({ where }),
      ]);

      // hitung isFollowedByMe kalau viewer login
      let followedSet = new Set();
      if (viewerId && rows.length) {
        const rels = await prisma.follow.findMany({
          where: {
            followerId: viewerId,
            followingId: { in: rows.map((u) => u.id) },
          },
          select: { followingId: true },
        });
        followedSet = new Set(rels.map((r) => r.followingId));
      }

      const users = rows.map((u) => ({
        ...u,
        isFollowedByMe: viewerId ? followedSet.has(u.id) : false,
      }));

      // PENTING: jangan pernah 404 di search → return list (bisa kosong)
      return successResponse(res, {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (e) {
      console.error("Search users error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/users/{username}:
 *   get:
 *     tags: [Users]
 *     summary: Get public profile by username
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: Not found
 */
router.get(
  "/:username",
  optionalAuth,
  [param("username").isString().trim().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username } = req.params;
      const viewerId = req.user?.id;

      const user = await prisma.user.findUnique({
        where: { username },
        select: {
          id: true,
          name: true,
          username: true,
          bio: true,
          avatarUrl: true,
          email: true,
          phone: true,
          _count: {
            select: { posts: true, followers: true, following: true },
          },
        },
      });
      if (!user) return errorResponse(res, "User not found", 404);

      // total likes yang DITERIMA user ini (akumulasi like pada semua post miliknya)
      const likeReceivedCount = await prisma.like.count({
        where: { post: { userId: user.id } },
      });

      let isFollowing = false;
      if (viewerId && viewerId !== user.id) {
        const rel = await prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: viewerId,
              followingId: user.id,
            },
          },
          select: { followerId: true },
        });
        isFollowing = !!rel;
      }

      return successResponse(res, {
        id: user.id,
        name: user.name,
        username: user.username,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        email: user.email,
        phone: user.phone,
        counts: {
          post: user._count.posts,
          followers: user._count.followers,
          following: user._count.following,
          likes: likeReceivedCount,
        },
        isFollowing,
        isMe: viewerId === user.id,
      });
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/users/{username}/posts:
 *   get:
 *     tags: [Users]
 *     summary: List posts by username (public)
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
  "/:username/posts",
  optionalAuth,
  [
    param("username").isString().trim().isLength({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const viewerId = req.user?.id;

      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
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
            ...(viewerId && {
              likes: { where: { userId: viewerId }, select: { userId: true } },
            }),
          },
        }),
        prisma.post.count({ where: { userId: user.id } }),
      ]);

      return successResponse(res, {
        posts: rows.map((p) => postSummary(p, viewerId)),
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
 *     tags: [Users]
 *     summary: List posts that this user has liked (public)
 *     description: Tab "Liked" di profil. Menampilkan post publik yang pernah di-like oleh user tsb.
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
  "/:username/likes",
  optionalAuth,
  [
    param("username").isString().trim().isLength({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { username } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const viewerId = req.user?.id;

      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (!user) return errorResponse(res, "User not found", 404);

      // Ambil post yang di-like oleh user ini
      const [likes, total] = await Promise.all([
        prisma.like.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: {
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
                _count: { select: { likes: true, comments: true } },
                ...(viewerId && {
                  likes: {
                    where: { userId: viewerId },
                    select: { userId: true },
                  },
                }),
              },
            },
          },
        }),
        prisma.like.count({ where: { userId: user.id } }),
      ]);

      const posts = likes
        .map((l) => l.post)
        .filter(Boolean)
        .map((p) => postSummary(p, viewerId));

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

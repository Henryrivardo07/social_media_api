const router = require("express").Router();
const { param, query } = require("express-validator");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/** optionalAuth: kalau ada token, set req.user; kalau tidak, lanjut publik */
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

/** helper ambil user by username */
async function getUserByUsernameOr404(username) {
  return prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, name: true, avatarUrl: true },
  });
}

/**
 * @swagger
 * tags:
 *   - name: Follow
 *     description: Follow / Unfollow & lists
 */

/**
 * @swagger
 * /api/follow/{username}:
 *   post:
 *     tags: [Follow]
 *     summary: Follow a user by username (idempotent)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Following }
 *       400: { description: Cannot follow yourself / invalid }
 *       404: { description: User not found }
 */
router.post(
  "/follow/:username",
  authenticateToken,
  [param("username").isString().trim().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const followerId = req.user.id;
      const { username } = req.params;
      const target = await getUserByUsernameOr404(username);
      if (!target) return errorResponse(res, "User not found", 404);
      if (target.id === followerId)
        return errorResponse(res, "You cannot follow yourself", 400);

      await prisma.follow.upsert({
        where: {
          followerId_followingId: { followerId, followingId: target.id },
        },
        update: {},
        create: { followerId, followingId: target.id },
      });

      return successResponse(res, { following: true }, "Now following");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/follow/{username}:
 *   delete:
 *     tags: [Follow]
 *     summary: Unfollow a user by username (idempotent)
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Unfollowed }
 *       404: { description: User not found }
 */
router.delete(
  "/follow/:username",
  authenticateToken,
  [param("username").isString().trim().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const followerId = req.user.id;
      const { username } = req.params;
      const target = await getUserByUsernameOr404(username);
      if (!target) return errorResponse(res, "User not found", 404);

      await prisma.follow
        .delete({
          where: {
            followerId_followingId: { followerId, followingId: target.id },
          },
        })
        .catch(() => null); // idempotent

      return successResponse(res, { following: false }, "Unfollowed");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/** helper format user summary */
const userSummary = (u, viewerId, viewerFollowMap) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  avatarUrl: u.avatarUrl,
  isFollowedByMe:
    viewerId && viewerFollowMap ? !!viewerFollowMap.get(u.id) : false,
});

/**
 * Ambil map orang yang sudah di-follow oleh viewer (untuk flag isFollowedByMe)
 */
async function buildViewerFollowMap(viewerId, userIds) {
  if (!viewerId || userIds.length === 0) return new Map();
  const rels = await prisma.follow.findMany({
    where: { followerId: viewerId, followingId: { in: userIds } },
    select: { followingId: true },
  });
  const map = new Map();
  rels.forEach((r) => map.set(r.followingId, true));
  return map;
}

/**
 * @swagger
 * /api/users/{username}/followers:
 *   get:
 *     tags: [Follow]
 *     summary: List followers of a user (public)
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
  "/users/:username/followers",
  optionalAuth,
  [
    param("username").isString().trim().isLength({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const viewerId = req.user?.id;
      const { username } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const owner = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (!owner) return errorResponse(res, "User not found", 404);

      const [rows, total] = await Promise.all([
        prisma.follow.findMany({
          where: { followingId: owner.id },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: {
            follower: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        }),
        prisma.follow.count({ where: { followingId: owner.id } }),
      ]);

      const users = rows.map((r) => r.follower);
      const viewerFollowMap = await buildViewerFollowMap(
        viewerId,
        users.map((u) => u.id)
      );

      return successResponse(res, {
        users: users.map((u) => userSummary(u, viewerId, viewerFollowMap)),
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
 * /api/users/{username}/following:
 *   get:
 *     tags: [Follow]
 *     summary: List users that a user follows (public)
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
  "/users/:username/following",
  optionalAuth,
  [
    param("username").isString().trim().isLength({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const viewerId = req.user?.id;
      const { username } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const owner = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (!owner) return errorResponse(res, "User not found", 404);

      const [rows, total] = await Promise.all([
        prisma.follow.findMany({
          where: { followerId: owner.id },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: {
            following: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        }),
        prisma.follow.count({ where: { followerId: owner.id } }),
      ]);

      const users = rows.map((r) => r.following);
      const viewerFollowMap = await buildViewerFollowMap(
        viewerId,
        users.map((u) => u.id)
      );

      return successResponse(res, {
        users: users.map((u) => userSummary(u, viewerId, viewerFollowMap)),
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
 * /api/me/followers:
 *   get:
 *     tags: [Follow]
 *     summary: List my followers
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
  "/me/followers",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const viewerId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const [rows, total] = await Promise.all([
        prisma.follow.findMany({
          where: { followingId: viewerId },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: {
            follower: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        }),
        prisma.follow.count({ where: { followingId: viewerId } }),
      ]);

      const users = rows.map((r) => r.follower);
      const viewerFollowMap = await buildViewerFollowMap(
        viewerId,
        users.map((u) => u.id)
      );

      return successResponse(res, {
        users: users.map((u) => userSummary(u, viewerId, viewerFollowMap)),
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
 * /api/me/following:
 *   get:
 *     tags: [Follow]
 *     summary: List users I follow
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
  "/me/following",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const viewerId = req.user.id;
      const { page = 1, limit = 20 } = req.query;

      const [rows, total] = await Promise.all([
        prisma.follow.findMany({
          where: { followerId: viewerId },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: {
            following: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        }),
        prisma.follow.count({ where: { followerId: viewerId } }),
      ]);

      const users = rows.map((r) => r.following);
      const viewerFollowMap = await buildViewerFollowMap(
        viewerId,
        users.map((u) => u.id)
      );

      return successResponse(res, {
        users: users.map((u) => userSummary(u, viewerId, viewerFollowMap)),
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

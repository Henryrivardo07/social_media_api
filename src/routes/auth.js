const router = require("express").Router();
const { body } = require("express-validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/database");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, username, email, password]
 *             properties:
 *               name: { type: string }
 *               username: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: User registered }
 *       400: { description: Validation or duplicate error }
 */
router.post(
  "/register",
  [
    body("name").isString().isLength({ min: 2 }),
    body("username").isString().isLength({ min: 3 }),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("phone").optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, username, email, phone, password } = req.body;

      // cek unik
      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });
      if (existing)
        return errorResponse(res, "Email/username already in use", 400);

      const hashed = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { name, username, email, phone, password: hashed },
      });

      return successResponse(
        res,
        { id: user.id, username: user.username },
        "Registered"
      );
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login and get token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string, format: password }
 *     responses:
 *       200: { description: Login success }
 *       401: { description: Invalid credentials }
 */
router.post(
  "/login",
  [body("email").isEmail(), body("password").isLength({ min: 6 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return errorResponse(res, "Invalid credentials", 401);

      const match = await bcrypt.compare(password, user.password);
      if (!match) return errorResponse(res, "Invalid credentials", 401);

      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      );

      return successResponse(res, { token }, "Login success");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

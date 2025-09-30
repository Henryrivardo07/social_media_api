// src/routes/auth.js
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
 *   - name: Auth
 *     description: Authentication (Register & Login)
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
 *               name:      { type: string, example: "John Doe" }
 *               username:  { type: string, example: "johndoe" }
 *               email:     { type: string, example: "john@email.com" }
 *               phone:     { type: string, example: "081234567890" }
 *               password:  { type: string, minLength: 6, example: "secret123" }
 *     responses:
 *       201: { description: Registered }
 *       400: { description: Validation or duplicate error }
 */
router.post(
  "/register",
  [
    body("name")
      .isString()
      .isLength({ min: 2 })
      .withMessage("Name is required"),
    body("username")
      .isString()
      .isLength({ min: 3 })
      .withMessage("Username min 3 chars"),
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
    body("phone").optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, username, email, phone, password } = req.body;

      // Cek unik email, username, dan phone (jika dikirim)
      const existing = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { username }, ...(phone ? [{ phone }] : [])],
        },
        select: { email: true, username: true, phone: true },
      });

      if (existing) {
        if (existing.email === email)
          return errorResponse(res, "Email already in use", 400);
        if (existing.username === username)
          return errorResponse(res, "Username already in use", 400);
        if (phone && existing.phone === phone)
          return errorResponse(res, "Phone already in use", 400);
      }

      const hashed = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { name, username, email, phone: phone || null, password: hashed },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          avatarUrl: true,
        },
      });

      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      );

      return successResponse(res, { token, user }, "Registered", 201);
    } catch (e) {
      // Tangkap unique constraint (antisipasi race condition)
      if (e?.code === "P2002") {
        const field = Array.isArray(e.meta?.target)
          ? e.meta.target[0]
          : "field";
        return errorResponse(res, `${field} already in use`, 400);
      }
      console.error("Register error:", e);
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
 *               email:    { type: string, example: "john@email.com" }
 *               password: { type: string, minLength: 6, example: "secret123" }
 *     responses:
 *       200:
 *         description: Login success
 *       401:
 *         description: Invalid credentials
 */
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Invalid password"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return errorResponse(res, "Invalid credentials", 401);

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return errorResponse(res, "Invalid credentials", 401);

      const token = jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      );

      return successResponse(
        res,
        {
          token,
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
          },
        },
        "Login success"
      );
    } catch (e) {
      console.error("Login error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;

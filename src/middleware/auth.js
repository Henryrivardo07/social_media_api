const jwt = require("jsonwebtoken");
const { errorResponse } = require("../utils/response");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return errorResponse(res, "Unauthorized", 401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return errorResponse(res, "Invalid token", 403);
    req.user = user; // { id, username }
    next();
  });
}

module.exports = { authenticateToken };

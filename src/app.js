require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const morgan = require("morgan");

const { connectDB } = require("./config/database");
const { swaggerUi, swaggerSpecs } = require("./config/swagger");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

// static landing
app.use(express.static(path.join(__dirname, "../public")));

// swagger
app.use(
  "/api-swagger",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, { customSiteTitle: "Sociality API Docs" })
);

// (NANTI) mount routes di sini:
app.use("/api/auth", require("./routes/auth"));
app.use("/api/me", require("./routes/me"));
app.use("/api/users", require("./routes/users"));
app.use("/api", require("./routes/posts"));
app.use("/api", require("./routes/feed"));
app.use("/api", require("./routes/likes"));
app.use("/api", require("./routes/comments"));
app.use("/api", require("./routes/follow"));
app.use("/api", require("./routes/saves"));

app.get("/health", (_req, res) =>
  res.json({ success: true, message: "Sociality API is running" })
);

connectDB();

module.exports = app;

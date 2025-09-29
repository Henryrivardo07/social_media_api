const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function connectDB() {
  try {
    await prisma.$connect();
    console.log("✅ Database connected");
  } catch (e) {
    console.error("❌ Database connection failed:", e);
    process.exit(1);
  }
}

module.exports = { prisma, connectDB };

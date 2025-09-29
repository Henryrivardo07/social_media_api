const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Sociality API",
      version: "1.0.0",
      description: "REST API untuk Sociality (Express + Prisma + PostgreSQL)",
    },
    servers: [{ url: process.env.SWAGGER_BASE_URL || "http://localhost:8080" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [],
    tags: [
      { name: "Auth" },
      { name: "My Profile" },
      { name: "Users" },
      { name: "Posts" },
      { name: "Feed" },
      { name: "Likes" },
      { name: "Comments" },
      { name: "Follow" },
      { name: "Saves" },
    ],
  },
  apis: ["./src/routes/*.js"],
};

const swaggerSpecs = swaggerJsdoc(options);

module.exports = { swaggerUi, swaggerSpecs };

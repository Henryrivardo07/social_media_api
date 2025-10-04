const app = require("./app");
const list = require("express-list-endpoints");

const PORT = process.env.PORT || 8081;

app.listen(PORT, () => {
  console.log(`🟢 Sociality API on :${PORT}`);
  console.log(`📍 Health  : http://localhost:${PORT}/health`);
  console.log(`📚 Swagger : http://localhost:${PORT}/api-swagger`);
  console.log(
    "📜 Registered Routes:",
    list(app).map((r) => r.path)
  );
});

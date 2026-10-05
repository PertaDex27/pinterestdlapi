import http from "http";
import { handleApi } from "./pindl.js";

const PORT = Number(process.env.PORT || 3210);
const server = http.createServer(async (req, res) => {
  const path = String(req.url || "/").split("?")[0];
  const last = path.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "index";
  const route = last === "api" ? "index" : last;
  await handleApi(req, res, /^\/api(\/|$)/.test(path) ? route : "index");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`pindl-api lokal jalan di http://0.0.0.0:${PORT}`);
});

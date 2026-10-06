// © XYNCTEAM
import { handleVideoToGif, handleVideoToGifUpload, sendErrorSafe } from "../videotogif.js";

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
        "access-control-allow-headers": "content-type,range,accept",
        "access-control-max-age": "86400"
      });
      res.end();
      return;
    }
    if (req.method === "POST") {
      await handleVideoToGifUpload(req, res);
      return;
    }
    await handleVideoToGif(req, res, new URL(req.url, "http://x").searchParams, "videotogif");
  } catch (err) {
    if (!res.headersSent) sendErrorSafe(res, err);
    else res.destroy();
  }
}

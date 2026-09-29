// Local preview with the same API handlers as Vercel. No external packages.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import art from "../api/diary-art.js";
import brief from "../api/art-brief.js";
import chat from "../api/paper-chat.js";
const root = resolve(new URL("..", import.meta.url).pathname);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
};
http
  .createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (
        path === "/api/diary-art" ||
        path === "/api/art-brief" ||
        path === "/api/paper-chat"
      ) {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16000) {
            res.writeHead(413);
            res.end();
            return;
          }
        }
        req.body = body;
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data));
        };
        return await (
          path === "/api/diary-art"
            ? art
            : path === "/api/art-brief"
              ? brief
              : chat
        )(req, res);
      }
      const file = resolve(
        root,
        "." + path + (path.endsWith("/") ? "index.html" : ""),
      );
      if (
        !file.startsWith(root + "/") ||
        path.split("/").some((p) => p.startsWith("."))
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(file);
      res.setHeader(
        "Content-Type",
        types[extname(file)] || "application/octet-stream",
      );
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(5173, "127.0.0.1", () =>
    console.log("Diary preview: http://localhost:5173/preview/"),
  );

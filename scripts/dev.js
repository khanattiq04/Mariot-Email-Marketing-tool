/**
 * Local dev runner.
 *
 *   npm run dev        start the /api runner + the React dev server
 *   npm run dev:api    start only the /api runner
 *
 * The CRA dev server only serves the React app, so requests to /api/* would
 * 404 under a plain `npm start`. This runs the same Vercel handler files from
 * ./api on a normal Node http server, adapting it to the (req, res) signature
 * they expect, so the app works on localhost without `vercel dev`.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "api");
const PORT = Number(process.env.API_PORT || 3001);
const API_ONLY = process.argv.includes("--api-only");

// Same precedence as CRA/Vercel: .env.local overrides .env. dotenv leaves
// already-set variables alone, so the higher priority file loads first.
for (const file of [".env.local", ".env"]) {
  require("dotenv").config({ path: path.join(ROOT, file) });
}

// Map /api/<name> to the handler file, the way Vercel routes them.
const routes = new Map();
for (const entry of fs.readdirSync(API_DIR)) {
  if (!entry.endsWith(".js")) continue;
  routes.set("/api/" + path.basename(entry, ".js"), path.join(API_DIR, entry));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Vercel hands handlers an Express-style response; add the parts they use.
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    if (payload && typeof payload === "object" && !Buffer.isBuffer(payload)) {
      return res.json(payload);
    }
    res.end(payload === undefined || payload === null ? "" : String(payload));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  decorate(res);

  const { pathname } = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const route = routes.get(pathname.replace(/\/+$/, ""));

  if (!route) {
    res.status(404).json({ error: "No local API route for " + pathname });
    return;
  }

  try {
    const raw = await readBody(req);
    req.body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    res.status(400).json({ error: "Request body must be valid JSON" });
    return;
  }

  console.log("[api] " + req.method + " " + pathname);

  try {
    await require(route)(req, res);
  } catch (err) {
    console.error("[api] " + pathname + " failed:", err);
    if (!res.writableEnded) res.status(500).json({ error: err.message });
  }
});

server.on("error", (err) => {
  console.error(
    err.code === "EADDRINUSE"
      ? "[api] port " + PORT + " is already in use - stop the other process or set API_PORT."
      : "[api] " + err.message
  );
  process.exit(1);
});

server.listen(PORT, () => {
  console.log("[api] serverless API on http://localhost:" + PORT);
  for (const route of routes.keys()) console.log("[api]   " + route);
});

if (!API_ONLY) {
  let shuttingDown = false;
  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (web && !web.killed) web.kill();
    process.exit(typeof code === "number" ? code : 0);
  };

  const web = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "react-scripts", "bin", "react-scripts.js"), "start"],
    { cwd: ROOT, stdio: "inherit" }
  );

  web.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log("[dev] web stopped (" + (signal || code) + "), shutting down.");
    shutdown(typeof code === "number" ? code : 0);
  });
  web.on("error", (err) => {
    console.error("[dev] could not start the React dev server: " + err.message);
    shutdown(1);
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}
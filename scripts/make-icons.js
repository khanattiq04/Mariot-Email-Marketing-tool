/**
 * Wrapper around scripts/make-icons.ps1, run by the prebuild hook so the icons
 * are refreshed from src/mariot-icon.webp on every `npm run build`.
 *
 * Generating icons must never break a build, so any problem is reported and the
 * existing icons are kept.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (process.platform !== "win32") {
  console.log("[icons] Skipped: icon generation needs Windows imaging.");
  process.exit(0);
}

const script = path.join(__dirname, "make-icons.ps1");

if (!fs.existsSync(script)) {
  console.log("[icons] Skipped: scripts/make-icons.ps1 is missing.");
  process.exit(0);
}

const result = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...process.argv.slice(2)],
  { stdio: "inherit", cwd: path.resolve(__dirname, "..") }
);

if (result.error || result.status !== 0) {
  console.warn("[icons] Could not regenerate icons - keeping the current ones.");
}

process.exit(0);

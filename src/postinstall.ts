#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..", "..", "..");
const hooksDir = join(projectRoot, ".claude", "hooks");
const hookSource = join(__dirname, "..", "hooks", "session-start.js");
const hookDest = join(hooksDir, "session-start.js");

if (!existsSync(hooksDir)) {
  mkdirSync(hooksDir, { recursive: true });
}

if (existsSync(hookSource)) {
  copyFileSync(hookSource, hookDest);
  console.log("Installed session-start.js hook");
}

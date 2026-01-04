#!/usr/bin/env node
/**
 * PreToolUse hook for Edit/Write tools
 * Suggests related files based on imports/dependencies
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname, basename } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DEPS_FILE = join(PROJECT_DIR, ".claude/.rag/deps.json");

let inputData;
try {
  inputData = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const toolName = inputData.tool_name || "";
const toolInput = inputData.tool_input || {};

// Only handle Edit/Write tools
if (!["Edit", "Write"].includes(toolName)) {
  process.exit(0);
}

const filePath = toolInput.file_path || "";
if (!filePath) process.exit(0);

// Skip non-code files
const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
const codeExts = [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"];
if (!codeExts.includes(ext)) process.exit(0);

// Check if deps graph exists
if (!existsSync(DEPS_FILE)) {
  process.exit(0);
}

try {
  const deps = JSON.parse(readFileSync(DEPS_FILE, "utf-8"));
  const nodes = deps.nodes || {};

  // Normalize file path for lookup
  const normalizedPath = filePath.replace(/\\/g, "/");
  const relativePath = normalizedPath.replace(PROJECT_DIR.replace(/\\/g, "/") + "/", "");

  // Find the node for this file
  let node = null;
  for (const [key, value] of Object.entries(nodes)) {
    if (key.endsWith(relativePath) || relativePath.endsWith(key) || key.includes(basename(filePath))) {
      node = value;
      break;
    }
  }

  if (!node) process.exit(0);

  const relatedFiles = [];

  // Files that import this file (may need updates)
  if (node.importedBy && node.importedBy.length > 0) {
    relatedFiles.push(...node.importedBy.slice(0, 3).map(f => `← ${basename(f)} (imports this)`));
  }

  // Files this file imports (context)
  if (node.imports && node.imports.length > 0) {
    const imported = node.imports
      .filter(i => i.resolvedPath && !i.resolvedPath.includes("node_modules"))
      .slice(0, 3)
      .map(i => `→ ${basename(i.resolvedPath)} (imported)`);
    relatedFiles.push(...imported);
  }

  if (relatedFiles.length === 0) process.exit(0);

  // Output suggestion (non-blocking)
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      decision: "approve", // Don't block, just inform
      reason: `📁 Related files:\n${relatedFiles.join("\n")}`
    }
  }));

} catch {
  // Silent fail
}

process.exit(0);

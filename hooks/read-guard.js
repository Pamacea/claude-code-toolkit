#!/usr/bin/env node
/**
 * PreToolUse hook for Read tool
 * Checks with the read optimizer before allowing file reads
 * - Tracks budget consumption
 * - Checks context lock status
 * - Suggests alternatives for low-importance files
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

// Only handle Read tool
if (input.tool_name !== "Read") process.exit(0);

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

// Get project root (look for package.json)
let rootDir = process.cwd();
let current = dirname(resolve(filePath));
for (let i = 0; i < 10; i++) {
  if (existsSync(`${current}/package.json`)) {
    rootDir = current;
    break;
  }
  current = dirname(current);
}

// Check optimizer decision
try {
  const result = execSync(
    `node "${__dirname}/../dist/search.js" optimizer -d "${rootDir}" -f "${filePath}"`,
    { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
  );

  // Parse result to check if blocked
  if (result.includes("❌ Read blocked")) {
    const reason = result.match(/Read blocked: (.+)/)?.[1] || "Optimizer blocked this read";

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        decision: "block",
        reason: `🛑 ${reason}\n\nSuggestions:\n• Use \`pnpm rag:context\` to find relevant code first\n• Use \`--signatures-only\` or \`--types-only\` for minimal context\n• Check budget with \`pnpm rag:budget\``
      }
    }));
    process.exit(0);
  }

  // Check for warnings
  if (result.includes("💡 Suggestions:")) {
    const suggestions = result.match(/💡 Suggestions:\n([\s\S]*?)(?:\n\n|$)/)?.[1] || "";

    // Allow but show warning
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        decision: "continue",
        reason: `⚠️ Read allowed with warnings:\n${suggestions.trim()}`
      }
    }));
    process.exit(0);
  }

} catch (err) {
  // Silently continue if optimizer check fails
}

// Allow read
process.exit(0);

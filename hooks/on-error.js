#!/usr/bin/env node
/**
 * PostToolUse hook for Bash commands
 * Automatically searches error DB when a command fails
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TOOLKIT_PATH = join(PROJECT_DIR, ".claude/toolkit/dist/search.js");

let inputData;
try {
  inputData = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const toolName = inputData.tool_name || "";
const toolResult = inputData.tool_result || {};

// Only handle Bash tool failures
if (toolName !== "Bash") {
  process.exit(0);
}

// Check if command failed (non-zero exit or error in output)
const output = toolResult.stdout || toolResult.stderr || "";
const exitCode = toolResult.exit_code;

// Detect if this looks like an error
const isError = exitCode !== 0 || 
  output.includes("error:") ||
  output.includes("Error:") ||
  output.includes("ERROR") ||
  output.includes("failed") ||
  output.includes("FAILED") ||
  output.includes("Cannot find") ||
  output.includes("not found") ||
  output.includes("TypeError") ||
  output.includes("SyntaxError") ||
  output.includes("ReferenceError");

if (!isError) {
  process.exit(0);
}

// Check if toolkit exists
if (!existsSync(TOOLKIT_PATH)) {
  process.exit(0);
}

// Extract error message (first line with error keyword or first non-empty line)
const lines = output.split("\n").filter(l => l.trim());
let errorMessage = lines.find(l => 
  /error|failed|cannot|not found/i.test(l)
) || lines[0] || "Unknown error";

// Truncate if too long
errorMessage = errorMessage.slice(0, 200);

// Search error DB
try {
  const result = execSync(
    `node "${TOOLKIT_PATH}" errors find -m "${errorMessage.replace(/"/g, '\\"')}" -d "${PROJECT_DIR}"`,
    { encoding: "utf-8", timeout: 5000 }
  );

  // If we found a match, output it as a hint
  if (result && !result.includes("No matching error pattern")) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        decision: "continue",
        reason: `💡 Found similar error in DB:\n${result.slice(0, 500)}`
      }
    }));
  }
} catch {
  // Silently fail - don't interrupt workflow
}

process.exit(0);

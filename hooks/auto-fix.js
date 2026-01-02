#!/usr/bin/env node
/**
 * PostToolUse hook for Bash commands
 * Enhanced error handling with auto-fix suggestions
 * When an error is found in DB with codeChanges, outputs actionable fix
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TOOLKIT_PATH = join(PROJECT_DIR, ".claude-code-toolkit/dist/search.js");
const ERRORS_DB = join(PROJECT_DIR, ".rag-errors.json");

let inputData;
try {
  inputData = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const toolName = inputData.tool_name || "";
const toolResult = inputData.tool_result || {};

// Only handle Bash tool failures
if (toolName !== "Bash") process.exit(0);

const output = toolResult.stdout || toolResult.stderr || "";
const exitCode = toolResult.exit_code;

// Detect errors
const errorPatterns = [
  /error:/i, /Error:/i, /ERROR/, /failed/i, /FAILED/,
  /Cannot find/i, /not found/i, /TypeError/, /SyntaxError/,
  /ReferenceError/, /Module not found/, /Cannot resolve/,
  /ENOENT/, /EACCES/, /Permission denied/
];

const isError = exitCode !== 0 || errorPatterns.some(p => p.test(output));
if (!isError) process.exit(0);

// Extract error message
const lines = output.split("\n").filter(l => l.trim());
let errorMessage = lines.find(l => errorPatterns.some(p => p.test(l))) || lines[0] || "Unknown error";
errorMessage = errorMessage.slice(0, 300);

// Check if we have the errors DB
if (!existsSync(ERRORS_DB)) process.exit(0);

try {
  const db = JSON.parse(readFileSync(ERRORS_DB, "utf-8"));
  const patterns = db.patterns || [];

  if (patterns.length === 0) process.exit(0);

  // Normalize for matching
  const normalizedError = normalizeError(errorMessage);

  // Find best match
  let bestMatch = null;
  let bestScore = 0;

  for (const pattern of patterns) {
    const score = similarity(normalizedError, pattern.normalizedMessage);
    if (score > bestScore && score > 0.5) {
      bestScore = score;
      bestMatch = pattern;
    }
  }

  if (!bestMatch) process.exit(0);

  // Build response
  let response = `🔍 **Found similar error** (${Math.round(bestScore * 100)}% match)\n`;
  response += `Type: ${bestMatch.errorType}\n\n`;
  response += `💡 **Solution:** ${bestMatch.solution.description}\n`;

  // Add steps if available
  if (bestMatch.solution.steps && bestMatch.solution.steps.length > 0) {
    response += `\n**Steps:**\n`;
    bestMatch.solution.steps.forEach((step, i) => {
      response += `${i + 1}. ${step}\n`;
    });
  }

  // Add commands if available
  if (bestMatch.solution.commands && bestMatch.solution.commands.length > 0) {
    response += `\n**Run:**\n`;
    bestMatch.solution.commands.forEach(cmd => {
      response += `\`${cmd}\`\n`;
    });
  }

  // Add code changes if available (the auto-fix part!)
  if (bestMatch.solution.codeChanges && bestMatch.solution.codeChanges.length > 0) {
    response += `\n**🔧 Auto-fix available:**\n`;
    bestMatch.solution.codeChanges.forEach(change => {
      response += `File: \`${change.file}\`\n`;
      response += `Replace:\n\`\`\`\n${change.before}\n\`\`\`\n`;
      response += `With:\n\`\`\`\n${change.after}\n\`\`\`\n`;
    });
  }

  // Update usage count
  bestMatch.metadata.lastUsed = Date.now();
  bestMatch.metadata.useCount++;
  db.stats.totalLookups++;
  db.stats.successfulMatches++;

  // Save updated DB (silent)
  try {
    const { writeFileSync } = await import("fs");
    writeFileSync(ERRORS_DB, JSON.stringify(db, null, 2));
  } catch {}

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      decision: "continue",
      reason: response.slice(0, 1500)
    }
  }));

} catch {
  // Silent fail
}

process.exit(0);

// Helper functions
function normalizeError(message) {
  return message
    .toLowerCase()
    .replace(/\d+/g, "N")
    .replace(/['"`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/at line \d+/gi, "at line N")
    .replace(/:\d+:\d+/g, ":N:N")
    .replace(/0x[a-f0-9]+/gi, "0xN")
    .replace(/\/[\w\-./]+\.(ts|js|tsx|jsx)/g, "/FILE")
    .trim()
    .slice(0, 200);
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

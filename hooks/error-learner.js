#!/usr/bin/env node
/**
 * PostToolUse hook for automatic error learning
 * Tracks error-resolution cycles and prompts to add to DB
 *
 * Flow:
 * 1. Bash command fails -> Store error in pending
 * 2. Edit tool used -> Store changes
 * 3. Similar Bash command succeeds -> Propose learning
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CLAUDE_DIR = join(PROJECT_DIR, ".claude");
const RAG_DIR = join(CLAUDE_DIR, ".rag");
const PENDING_FILE = join(RAG_DIR, "pending-errors.json");
const ERRORS_DB = join(RAG_DIR, "errors.json");

let inputData;
try {
  inputData = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

const toolName = inputData.tool_name || "";
const toolInput = inputData.tool_input || {};
const toolResult = inputData.tool_result || {};

// Load pending errors
function loadPending() {
  if (!existsSync(PENDING_FILE)) return { errors: [], edits: [] };
  try {
    return JSON.parse(readFileSync(PENDING_FILE, "utf-8"));
  } catch {
    return { errors: [], edits: [] };
  }
}

function savePending(data) {
  try {
    writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// Extract error message from output
function extractErrorMessage(output) {
  const lines = output.split("\n").filter(l => l.trim());
  const errorLine = lines.find(l =>
    /error|failed|cannot|not found|exception/i.test(l)
  );
  return (errorLine || lines[0] || "").slice(0, 300);
}

// Check if command is similar (same base command)
function isSimilarCommand(cmd1, cmd2) {
  const base1 = cmd1.split(/\s+/)[0];
  const base2 = cmd2.split(/\s+/)[0];
  return base1 === base2;
}

// Normalize error for comparison
function normalizeError(msg) {
  return msg
    .toLowerCase()
    .replace(/\d+/g, "N")
    .replace(/['"`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\/[\w\-./]+\.(ts|js|tsx|jsx)/g, "/FILE")
    .trim();
}

// Load error DB
function loadErrorDB() {
  if (!existsSync(ERRORS_DB)) {
    return { version: "1.0.0", patterns: [], stats: { totalPatterns: 0, totalLookups: 0, successfulMatches: 0, lastUpdated: Date.now() } };
  }
  try {
    return JSON.parse(readFileSync(ERRORS_DB, "utf-8"));
  } catch {
    return { version: "1.0.0", patterns: [], stats: { totalPatterns: 0, totalLookups: 0, successfulMatches: 0, lastUpdated: Date.now() } };
  }
}

// Detect error type
function detectErrorType(message) {
  const patterns = [
    { regex: /TypeError/i, type: "TypeError" },
    { regex: /SyntaxError/i, type: "SyntaxError" },
    { regex: /ReferenceError/i, type: "ReferenceError" },
    { regex: /ENOENT/i, type: "FileNotFound" },
    { regex: /EACCES/i, type: "PermissionError" },
    { regex: /Module not found/i, type: "ModuleNotFound" },
    { regex: /Cannot find module/i, type: "ModuleNotFound" },
    { regex: /build failed/i, type: "BuildError" },
    { regex: /compilation failed/i, type: "BuildError" },
    { regex: /test failed/i, type: "TestError" },
  ];
  for (const { regex, type } of patterns) {
    if (regex.test(message)) return type;
  }
  return "Error";
}

// Detect tags
function detectTags(message) {
  const tags = [];
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes("typescript") || lowerMsg.includes(".ts")) tags.push("typescript");
  if (lowerMsg.includes("react") || lowerMsg.includes("jsx")) tags.push("react");
  if (lowerMsg.includes("node") || lowerMsg.includes("npm") || lowerMsg.includes("pnpm")) tags.push("node");
  if (lowerMsg.includes("import") || lowerMsg.includes("module")) tags.push("modules");
  if (lowerMsg.includes("build") || lowerMsg.includes("tsc")) tags.push("build");
  return tags;
}

// Generate error ID
function generateErrorId(normalizedMessage, errorType) {
  const hash = crypto.createHash("sha256")
    .update(`${errorType}:${normalizedMessage}`)
    .digest("hex")
    .slice(0, 12);
  return `err_${hash}`;
}

// Add error to DB
function addErrorToDB(errorMessage, solution, codeChanges) {
  const db = loadErrorDB();
  const errorType = detectErrorType(errorMessage);
  const normalizedMessage = normalizeError(errorMessage);
  const id = generateErrorId(normalizedMessage, errorType);

  // Check if exists
  const existing = db.patterns.find(p => p.id === id);
  if (existing) {
    existing.metadata.useCount++;
    existing.metadata.lastUsed = Date.now();
    writeFileSync(ERRORS_DB, JSON.stringify(db, null, 2));
    return null; // Already exists
  }

  const pattern = {
    id,
    errorType,
    errorMessage: errorMessage.slice(0, 500),
    normalizedMessage,
    context: {},
    solution: {
      description: solution,
      steps: [],
      codeChanges: codeChanges || [],
      commands: [],
      preventionTips: [],
    },
    metadata: {
      createdAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
      tags: detectTags(errorMessage),
      severity: "medium",
    },
  };

  db.patterns.push(pattern);
  db.stats.totalPatterns++;
  db.stats.lastUpdated = Date.now();

  writeFileSync(ERRORS_DB, JSON.stringify(db, null, 2));
  return pattern;
}

const pending = loadPending();

// Handle Bash tool
if (toolName === "Bash") {
  const command = toolInput.command || "";
  const output = toolResult.stdout || toolResult.stderr || "";
  const exitCode = toolResult.exit_code;

  const errorPatterns = [
    /error:/i, /Error:/i, /failed/i, /Cannot find/i,
    /not found/i, /TypeError/, /SyntaxError/, /ENOENT/
  ];

  const isError = exitCode !== 0 || errorPatterns.some(p => p.test(output));

  if (isError) {
    // Store pending error
    const errorMsg = extractErrorMessage(output);
    pending.errors.push({
      command,
      errorMessage: errorMsg,
      normalizedError: normalizeError(errorMsg),
      timestamp: Date.now(),
    });
    // Keep only last 5 errors
    pending.errors = pending.errors.slice(-5);
    savePending(pending);
  } else {
    // Command succeeded - check if it resolves a pending error
    for (let i = pending.errors.length - 1; i >= 0; i--) {
      const pendingError = pending.errors[i];
      if (isSimilarCommand(pendingError.command, command)) {
        // Found a resolution!
        const recentEdits = pending.edits.filter(e =>
          e.timestamp > pendingError.timestamp
        );

        if (recentEdits.length > 0) {
          // Build code changes from edits
          const codeChanges = recentEdits.map(e => ({
            file: e.file,
            before: e.oldString.slice(0, 200),
            after: e.newString.slice(0, 200),
          }));

          // Build solution description from edits
          const filesChanged = [...new Set(recentEdits.map(e => e.file))];
          const solution = `Fixed by editing ${filesChanged.length} file(s): ${filesChanged.map(f => f.split("/").pop()).join(", ")}`;

          // Auto-add to DB
          const added = addErrorToDB(pendingError.errorMessage, solution, codeChanges);

          // Clean up
          pending.errors.splice(i, 1);
          pending.edits = [];
          savePending(pending);

          if (added) {
            console.log(JSON.stringify({
              hookSpecificOutput: {
                hookEventName: "PostToolUse",
                decision: "continue",
                reason: `\u2705 **Auto-learned error pattern!**\n\nError: \`${pendingError.errorMessage.slice(0, 80)}...\`\nType: ${added.errorType}\nSolution: ${solution}\n\nAdded to error DB for future reference.`
              }
            }));
          }
        }

        break;
      }
    }
  }
}

// Handle Edit tool - track changes
if (toolName === "Edit") {
  const file = toolInput.file_path || "";
  const oldString = toolInput.old_string || "";
  const newString = toolInput.new_string || "";

  if (pending.errors.length > 0 && oldString && newString) {
    pending.edits.push({
      file,
      oldString,
      newString,
      timestamp: Date.now(),
    });
    // Keep only last 10 edits
    pending.edits = pending.edits.slice(-10);
    savePending(pending);
  }
}

// Clean old pending errors (> 10 min)
const tenMinutes = 10 * 60 * 1000;
const now = Date.now();
pending.errors = pending.errors.filter(e => now - e.timestamp < tenMinutes);
pending.edits = pending.edits.filter(e => now - e.timestamp < tenMinutes);
savePending(pending);

process.exit(0);

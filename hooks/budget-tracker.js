#!/usr/bin/env node
/**
 * PostToolUse hook for Read tool
 * Tracks token consumption in the read budget
 * Shows warnings when budget is getting low
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHARS_PER_TOKEN = 4;
const WARNING_THRESHOLD = 0.7;
const CRITICAL_THRESHOLD = 0.9;

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

// Only handle Read tool
if (input.tool_name !== "Read") process.exit(0);

const result = input.tool_result;
if (!result || typeof result !== "string") process.exit(0);

const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

// Get project root
let rootDir = process.cwd();
let current = dirname(resolve(filePath));
for (let i = 0; i < 10; i++) {
  if (existsSync(`${current}/package.json`)) {
    rootDir = current;
    break;
  }
  current = dirname(current);
}

// Load or create budget
const ragDir = `${rootDir}/.claude/.rag`;
const budgetFile = `${ragDir}/budget.json`;
let budget;

if (existsSync(budgetFile)) {
  try {
    budget = JSON.parse(readFileSync(budgetFile, "utf-8"));
  } catch {
    process.exit(0);
  }
} else {
  // No budget tracking - exit silently
  process.exit(0);
}

// Calculate tokens consumed
const lines = result.split("\n").length;
const tokens = Math.ceil(result.length / CHARS_PER_TOKEN);

// Record the read
const entry = {
  timestamp: new Date().toISOString(),
  filePath: filePath,
  lines: lines,
  estimatedTokens: tokens,
  level: "full"
};

budget.reads.push(entry);
budget.consumed += tokens;

// Check thresholds
const ratio = budget.consumed / budget.totalBudget;
let alertMessage = null;

if (ratio >= 1) {
  // Budget exceeded
  const alert = {
    timestamp: new Date().toISOString(),
    type: "exceeded",
    message: `❌ Budget exceeded! ${Math.round(ratio * 100)}% used`,
    consumed: budget.consumed,
    budget: budget.totalBudget
  };
  budget.alerts.push(alert);
  alertMessage = `🔴 **TOKEN BUDGET EXCEEDED**\n\nConsumed: ${budget.consumed.toLocaleString()} / ${budget.totalBudget.toLocaleString()} tokens (${Math.round(ratio * 100)}%)\n\n⚠️ Consider:\n• Use \`pnpm rag:budget increase --add 10000 --reason "..."\`\n• Switch to \`--signatures-only\` or \`--types-only\` modes\n• Use \`pnpm rag:context\` instead of direct reads`;
} else if (ratio >= CRITICAL_THRESHOLD) {
  // Critical
  const alert = {
    timestamp: new Date().toISOString(),
    type: "warning",
    message: `🔴 Budget critical: ${Math.round(ratio * 100)}%`,
    consumed: budget.consumed,
    budget: budget.totalBudget
  };
  budget.alerts.push(alert);
  alertMessage = `🔴 **Budget Critical** (${Math.round(ratio * 100)}%)\n\nRemaining: ~${(budget.totalBudget - budget.consumed).toLocaleString()} tokens\n\n💡 Switch to minimal context modes`;
} else if (ratio >= WARNING_THRESHOLD) {
  // Warning
  alertMessage = `🟡 Budget at ${Math.round(ratio * 100)}% - ${(budget.totalBudget - budget.consumed).toLocaleString()} tokens remaining`;
}

// Save updated budget
try {
  writeFileSync(budgetFile, JSON.stringify(budget, null, 2));
} catch {
  // Ignore write errors
}

// Output alert if any
if (alertMessage) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      decision: "continue",
      reason: alertMessage
    }
  }));
}

#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.cwd();
const CLAUDE_DIR = join(PROJECT_DIR, ".claude");
const RAG_DIR = join(CLAUDE_DIR, ".rag");
const TOOLKIT_PATH = ".claude/toolkit/dist/search.js";
const CLI_PATH = ".claude/toolkit/dist/cli.js";

function safeExec(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30000,
      cwd: PROJECT_DIR,
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

function ensureRagDir() {
  if (!existsSync(RAG_DIR)) {
    mkdirSync(RAG_DIR, { recursive: true });
  }
}

try {
  const toolkitScript = join(PROJECT_DIR, TOOLKIT_PATH);
  const cliScript = join(PROJECT_DIR, CLI_PATH);

  if (!existsSync(toolkitScript)) {
    console.log("RAG not built");
    process.exit(0);
  }

  // Ensure .rag directory exists
  ensureRagDir();

  // 1. Update RAG index (incremental - fast)
  const ragIndexPath = join(RAG_DIR, "index.json");
  if (!existsSync(ragIndexPath)) {
    console.log("Creating RAG index (first time)...");
    execSync(`node "${cliScript}" index -d "${PROJECT_DIR}"`, {
      cwd: PROJECT_DIR,
      stdio: "inherit",
      timeout: 120000
    });
  } else {
    // Check for changes and update incrementally
    const checkResult = safeExec(`node "${toolkitScript}" watch -d "${PROJECT_DIR}" --check`);
    if (checkResult && checkResult.includes("Changes detected")) {
      execSync(`node "${toolkitScript}" watch -d "${PROJECT_DIR}"`, {
        cwd: PROJECT_DIR,
        stdio: "inherit",
        timeout: 60000
      });
    }
  }

  // 2. Build deps graph if missing (needed for importance)
  const depsPath = join(RAG_DIR, "deps.json");
  if (!existsSync(depsPath)) {
    safeExec(`node "${toolkitScript}" deps -d "${PROJECT_DIR}" --build`);
  }

  // 3. Build importance index if missing
  const importancePath = join(RAG_DIR, "importance.json");
  if (!existsSync(importancePath)) {
    safeExec(`node "${toolkitScript}" importance -d "${PROJECT_DIR}" build`);
  }

  // 4. Initialize budget if not present (default 50000 tokens)
  const budgetPath = join(RAG_DIR, "budget.json");
  if (!existsSync(budgetPath)) {
    safeExec(`node "${toolkitScript}" budget -d "${PROJECT_DIR}" init --limit 40000`);
  }

  // 5. Load session summary (compact for context)
  const sessionSummary = safeExec(`node "${toolkitScript}" session -d "${PROJECT_DIR}" --compact`);

  // 6. Load project memory
  const memory = safeExec(`node "${toolkitScript}" memory -d "${PROJECT_DIR}"`);

  // 7. Get optimizer status (unified view)
  const optimizerStatus = safeExec(`node "${toolkitScript}" optimizer -d "${PROJECT_DIR}"`);

  // 8. Check for recent errors in DB
  const errorStats = safeExec(`node "${toolkitScript}" errors -d "${PROJECT_DIR}"`);
  const hasErrors = errorStats && !errorStats.includes("Total patterns: 0");

  // 9. Check for snippets
  const snippetStats = safeExec(`node "${toolkitScript}" snippets -d "${PROJECT_DIR}"`);
  const hasSnippets = snippetStats && !snippetStats.includes("Total snippets: 0");

  // 10. Check for active hypothesis session
  const hypothesisPath = join(RAG_DIR, "hypothesis.json");
  let activeHypothesis = null;
  if (existsSync(hypothesisPath)) {
    try {
      const data = JSON.parse(readFileSync(hypothesisPath, "utf-8"));
      const pending = data.hypotheses?.filter(h => h.status === "pending")?.length || 0;
      if (pending > 0) {
        activeHypothesis = { task: data.task, pending };
      }
    } catch {}
  }

  // Output context
  console.log(`<session-context project="anima">

## Project Memory
${memory || "Memory unavailable"}

## Session Status
${sessionSummary || "New session"}

## Read Optimizer v5.0
${optimizerStatus || "Optimizer status unavailable"}
${activeHypothesis ? `
## Active Hypothesis Session
Task: ${activeHypothesis.task}
Pending hypotheses: ${activeHypothesis.pending}
Use \`pnpm rag:hypothesis\` to continue investigating.
` : ""}${hasErrors ? `
## Error Patterns Available
Use \`pnpm rag:errors find -m "error message"\` to search for known solutions.
` : ""}${hasSnippets ? `
## Code Snippets Available
Use \`pnpm rag:snippets --search "query"\` to find reusable patterns.
` : ""}
</session-context>`);

} catch (e) {
  console.error("Session start hook error:", e.message);
  process.exit(0);
}

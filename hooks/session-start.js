#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.cwd();
const TOOLKIT_PATH = "plugins/claude-code-toolkit/dist/search.js";
const CLI_PATH = "plugins/claude-code-toolkit/dist/cli.js";

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

try {
  const toolkitScript = join(PROJECT_DIR, TOOLKIT_PATH);
  const cliScript = join(PROJECT_DIR, CLI_PATH);

  if (!existsSync(toolkitScript)) {
    console.log("RAG indexer not built. Run: cd plugins/claude-code-toolkit && pnpm build");
    process.exit(0);
  }

  // 1. Update RAG index (incremental - fast)
  const ragIndexPath = join(PROJECT_DIR, ".rag-index.json");
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

  // 2. Load session summary (compact for context)
  const sessionSummary = safeExec(`node "${toolkitScript}" session -d "${PROJECT_DIR}" --compact`);

  // 3. Load project memory
  const memory = safeExec(`node "${toolkitScript}" memory -d "${PROJECT_DIR}"`);

  // 4. Check for recent errors in DB
  const errorStats = safeExec(`node "${toolkitScript}" errors -d "${PROJECT_DIR}"`);
  const hasErrors = errorStats && !errorStats.includes("Total patterns: 0");

  // 5. Check for snippets
  const snippetStats = safeExec(`node "${toolkitScript}" snippets -d "${PROJECT_DIR}"`);
  const hasSnippets = snippetStats && !snippetStats.includes("Total snippets: 0");

  // Output context
  console.log(`<session-context project="anima">

## Project Memory
${memory || "Memory unavailable"}

## Session Status
${sessionSummary || "New session"}
${hasErrors ? `
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

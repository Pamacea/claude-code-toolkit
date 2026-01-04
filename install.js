#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir, platform } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLKIT_ROOT = __dirname;
const CLAUDE_LOCAL_DIR = join(__dirname, "..");
const PROJECT_ROOT = join(CLAUDE_LOCAL_DIR, "..");
const IS_WINDOWS = platform() === "win32";

const CLAUDE_DIR = join(homedir(), ".claude");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");
const SCRIPTS_DIR = join(CLAUDE_DIR, "scripts");
const HOOKS_DIR = join(CLAUDE_DIR, "hooks");

// Files that should be added to .gitignore
const GENERATED_FILES = [
  ".claude/.rag/",
  ".rag-index.json",
  ".rag-cache.json",
  ".rag-deps.json",
  ".rag-hashes.json",
  ".claude-memory.json",
  ".rag-session.json",
  ".rag-errors.json",
  ".rag-snippets.json",
];

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`✅ Created ${dir}`);
  }
}

function escapePath(p) {
  return IS_WINDOWS ? p.replace(/\\/g, "\\\\") : p;
}

function writeCommand(name, content) {
  const dest = join(COMMANDS_DIR, `${name}.md`);
  writeFileSync(dest, content);
  console.log(`✅ Installed command: /${name}`);
}

function writeScript(name, content) {
  const dest = join(SCRIPTS_DIR, name);
  writeFileSync(dest, content);
  console.log(`✅ Installed script: ${name}`);
}

function writeHook(name, content) {
  const dest = join(HOOKS_DIR, name);
  writeFileSync(dest, content);
  console.log(`✅ Installed hook: ${name}`);
}

function updateGitignore(projectDir) {
  const gitignorePath = join(projectDir, ".gitignore");
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  const missingFiles = GENERATED_FILES.filter(file => !content.includes(file));
  if (missingFiles.length === 0) {
    console.log(`✅ .gitignore already has all Claude Toolkit entries`);
    return;
  }
  const section = `\n# Claude Toolkit (auto-added)\n${missingFiles.join("\n")}\n`;
  appendFileSync(gitignorePath, section);
  console.log(`✅ Added ${missingFiles.length} entries to .gitignore`);
}

// ============================================================
// COMMANDS
// ============================================================

const RAG_COMMAND = `# RAG Search - Semantic Codebase Search

Search the indexed codebase using semantic search.

## Usage
\`/rag <query>\`

## Instructions
Run: \`node .claude/toolkit/dist/search.js context "$ARGUMENTS" -d . -k 8\`

## Options
- \`-k <number>\` - Number of results (default: 8)
- \`--with-deps\` - Include dependency info
- \`--signatures-only\` - Minimal output
`;

const DIFF_COMMAND = `# Diff Context - Git Changes

Get structured context from git diff.

## Usage
\`/diff [options]\`

## Instructions
Run: \`node .claude/toolkit/dist/search.js diff -d . $ARGUMENTS\`

## Options
- \`--staged\` - Only staged changes
- \`--summary\` - Compact output
- \`--files-only\` - List files only
`;

const MEMORY_COMMAND = `# Project Memory - Compressed Context

Get auto-generated project summary.

## Usage
\`/memory\`

## Instructions
Run: \`node .claude/toolkit/dist/search.js memory -d .\`

## Options
- \`--generate\` - Force regeneration
- \`--json\` - Output as JSON
`;

const SESSION_COMMAND = `# Session Summary - Context Continuity

Get session summary for context continuity. Auto-saved on session end.

## Usage
\`/session [options]\`

## Instructions
Run: \`node .claude/toolkit/dist/search.js session -d . $ARGUMENTS\`

## Options
- \`--compact\` - Short summary
- \`--new\` - Start new session
- \`--context "text"\` - Set work context

## Auto-management
- Loaded at session start (SessionStart hook)
- Saved at session end (Stop hook)
`;

const ERRORS_COMMAND = `# Error Pattern DB - Known Solutions

Search and manage error patterns database.

## Usage
\`/errors [action] [options]\`

## Instructions
Search: \`node .claude/toolkit/dist/search.js errors find -m "error message" -d .\`
Add: \`node .claude/toolkit/dist/search.js errors add -t "Type" -m "msg" -s "solution" -d .\`

## Options
- \`find -m "msg"\` - Find matching pattern
- \`add -t -m -s\` - Add new pattern
- \`--search "query"\` - Search by keyword
- \`--recent\` / \`--common\` - List errors
`;

const SNIPPETS_COMMAND = `# Code Snippets Cache - Reusable Patterns

Search and manage code snippets cache.

## Usage
\`/snippets [action] [options]\`

## Instructions
Search: \`node .claude/toolkit/dist/search.js snippets --search "query" -d .\`
Add: \`node .claude/toolkit/dist/search.js snippets add -n "name" --code "code" -d .\`

## Options
- \`--search "query"\` - Search snippets
- \`--get "name"\` - Get by name
- \`-c category\` - Filter by category
- \`--popular\` / \`--recent\` - List snippets
`;

// ============================================================
// SCRIPTS & HOOKS
// ============================================================

function getContextLoaderScript() {
  return `#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TOOLKIT = ".claude/toolkit/dist/search.js";

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", maxBuffer: 5*1024*1024, timeout: 30000, cwd: PROJECT_DIR }).trim();
  } catch { return null; }
}

const script = join(PROJECT_DIR, TOOLKIT);
if (!existsSync(script)) { console.log("RAG not built"); process.exit(0); }

const memory = safeExec(\`node "\${script}" memory -d "\${PROJECT_DIR}"\`);
const session = safeExec(\`node "\${script}" session -d "\${PROJECT_DIR}" --compact\`);
const errors = safeExec(\`node "\${script}" errors -d "\${PROJECT_DIR}"\`);
const hasErrors = errors && !errors.includes("Total patterns: 0");

console.log(\`<session-context>
## Memory
\${memory || "N/A"}

## Session
\${session || "New"}
\${hasErrors ? "\\n## Error DB Available - use /errors" : ""}
</session-context>\`);
`;
}

function getSuggestRagHook() {
  return `#!/usr/bin/env node
import { readFileSync } from "fs";
import { basename } from "path";

let input;
try { input = JSON.parse(readFileSync(0, "utf-8")); } catch { process.exit(0); }

if (input.tool_name !== "Read") process.exit(0);

const path = input.tool_input?.file_path || "";
const skip = [".json",".md",".txt",".env",".yml",".css",".html",".svg",".png"];
const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
if (skip.includes(ext)) process.exit(0);
if (["node_modules","dist",".git"].some(p => path.includes(p))) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: \`Consider /rag first for \${basename(path)}?\`
  }
}));
`;
}

function getOnErrorHook() {
  return `#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TOOLKIT = join(PROJECT_DIR, ".claude/toolkit/dist/search.js");

let input;
try { input = JSON.parse(readFileSync(0, "utf-8")); } catch { process.exit(0); }

if (input.tool_name !== "Bash") process.exit(0);
if (!existsSync(TOOLKIT)) process.exit(0);

const output = input.tool_result?.stdout || input.tool_result?.stderr || "";
const isError = output.includes("error:") || output.includes("Error:") || output.includes("failed");
if (!isError) process.exit(0);

const lines = output.split("\\n").filter(l => l.trim());
const msg = (lines.find(l => /error|failed/i.test(l)) || lines[0] || "").slice(0, 200);

try {
  const result = execSync(\`node "\${TOOLKIT}" errors find -m "\${msg.replace(/"/g, "")}" -d "\${PROJECT_DIR}"\`,
    { encoding: "utf-8", timeout: 5000 });
  if (result && !result.includes("No matching")) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", decision: "continue", reason: "Found in error DB:\\n" + result.slice(0, 300) } }));
  }
} catch {}
`;
}

function getSessionEndHook() {
  return `#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SESSION_FILE = join(PROJECT_DIR, ".rag-session.json");

function safeExec(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", cwd: PROJECT_DIR, timeout: 10000 }).trim(); }
  catch { return null; }
}

try {
  let session = { version: "1.0.0" };
  if (existsSync(SESSION_FILE)) {
    try { session = JSON.parse(readFileSync(SESSION_FILE, "utf-8")); } catch {}
  }

  const now = Date.now();
  session.lastUpdated = now;
  session.endedAt = now;
  session.branch = safeExec("git branch --show-current") || "unknown";

  const status = safeExec("git status --porcelain");
  session.modifiedFiles = status ? status.split("\\n").filter(l => l.trim()).map(l => l.slice(3).trim()).slice(0, 20) : [];

  const log = safeExec("git log -1 --format=%H|%s|%at");
  if (log) {
    const [hash, message, ts] = log.split("|");
    session.lastCommit = { hash: hash.slice(0, 7), message, timestamp: parseInt(ts) * 1000 };
  }

  if (session.startedAt) session.duration = Math.round((now - session.startedAt) / 60000);

  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  console.log(\`Session saved: \${session.duration || 0}min | \${session.modifiedFiles?.length || 0} files\`);
} catch { console.log("Session save skipped"); }
`;
}

function getSmartFilesHook() {
  return `#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const DEPS_FILE = join(PROJECT_DIR, ".rag-deps.json");

let input;
try { input = JSON.parse(readFileSync(0, "utf-8")); } catch { process.exit(0); }

if (!["Edit", "Write"].includes(input.tool_name)) process.exit(0);
const filePath = input.tool_input?.file_path || "";
if (!filePath) process.exit(0);

const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) process.exit(0);
if (!existsSync(DEPS_FILE)) process.exit(0);

try {
  const deps = JSON.parse(readFileSync(DEPS_FILE, "utf-8"));
  const nodes = deps.nodes || {};
  const fileName = basename(filePath);

  let node = null;
  for (const [key, value] of Object.entries(nodes)) {
    if (key.includes(fileName)) { node = value; break; }
  }
  if (!node) process.exit(0);

  const related = [];
  if (node.importedBy?.length) related.push(...node.importedBy.slice(0, 3).map(f => "← " + basename(f)));
  if (node.imports?.length) {
    const imp = node.imports.filter(i => i.resolvedPath && !i.resolvedPath.includes("node_modules")).slice(0, 3);
    related.push(...imp.map(i => "→ " + basename(i.resolvedPath)));
  }
  if (!related.length) process.exit(0);

  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", decision: "approve", reason: "📁 Related: " + related.join(", ") } }));
} catch {}
`;
}

function getAutoFixHook() {
  return `#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ERRORS_DB = join(PROJECT_DIR, ".rag-errors.json");

let input;
try { input = JSON.parse(readFileSync(0, "utf-8")); } catch { process.exit(0); }

if (input.tool_name !== "Bash") process.exit(0);
const output = input.tool_result?.stdout || input.tool_result?.stderr || "";
const exitCode = input.tool_result?.exit_code;

const errPat = [/error:/i, /Error:/, /failed/i, /Cannot find/i, /not found/i, /TypeError/, /SyntaxError/, /Module not found/];
const isError = exitCode !== 0 || errPat.some(p => p.test(output));
if (!isError || !existsSync(ERRORS_DB)) process.exit(0);

const lines = output.split("\\n").filter(l => l.trim());
let msg = (lines.find(l => errPat.some(p => p.test(l))) || lines[0] || "").slice(0, 300);
const norm = msg.toLowerCase().replace(/\\d+/g, "N").replace(/['"\`]/g, "").replace(/\\s+/g, " ").slice(0, 200);

try {
  const db = JSON.parse(readFileSync(ERRORS_DB, "utf-8"));
  let best = null, bestScore = 0;
  for (const p of db.patterns || []) {
    const wordsA = new Set(norm.split(/\\s+/)), wordsB = new Set(p.normalizedMessage.split(/\\s+/));
    let inter = 0; for (const w of wordsA) if (wordsB.has(w)) inter++;
    const score = inter / (wordsA.size + wordsB.size - inter);
    if (score > bestScore && score > 0.4) { bestScore = score; best = p; }
  }
  if (!best) process.exit(0);

  let res = "🔍 **" + best.errorType + "** (" + Math.round(bestScore * 100) + "% match)\\n";
  res += "💡 " + best.solution.description + "\\n";
  if (best.solution.steps?.length) res += "\\nSteps: " + best.solution.steps.join(" → ");
  if (best.solution.commands?.length) res += "\\n\\nRun: \\\`" + best.solution.commands[0] + "\\\`";
  if (best.solution.codeChanges?.length) {
    const c = best.solution.codeChanges[0];
    res += "\\n\\n🔧 **Auto-fix:** \\\`" + c.file + "\\\`\\nReplace: \\\`" + c.before.slice(0, 50) + "\\\` → \\\`" + c.after.slice(0, 50) + "\\\`";
  }

  best.metadata.lastUsed = Date.now();
  best.metadata.useCount++;
  db.stats.totalLookups++;
  db.stats.successfulMatches++;
  try { writeFileSync(ERRORS_DB, JSON.stringify(db, null, 2)); } catch {}

  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", decision: "continue", reason: res.slice(0, 800) } }));
} catch {}
`;
}

function getErrorLearnerHook() {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CLAUDE_DIR = join(PROJECT_DIR, ".claude");
const RAG_DIR = join(CLAUDE_DIR, ".rag");
const PENDING_FILE = join(RAG_DIR, "pending-errors.json");
const ERRORS_DB = join(RAG_DIR, "errors.json");

let inputData;
try { inputData = JSON.parse(readFileSync(0, "utf-8")); } catch { process.exit(0); }

const toolName = inputData.tool_name || "";
const toolInput = inputData.tool_input || {};
const toolResult = inputData.tool_result || {};

function loadPending() {
  if (!existsSync(PENDING_FILE)) return { errors: [], edits: [] };
  try { return JSON.parse(readFileSync(PENDING_FILE, "utf-8")); } catch { return { errors: [], edits: [] }; }
}
function savePending(data) { try { writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); } catch {} }

function extractErrorMessage(output) {
  const lines = output.split("\\n").filter(l => l.trim());
  return (lines.find(l => /error|failed|cannot|not found/i.test(l)) || lines[0] || "").slice(0, 300);
}

function isSimilarCommand(cmd1, cmd2) { return cmd1.split(/\\s+/)[0] === cmd2.split(/\\s+/)[0]; }

function normalizeError(msg) {
  return msg.toLowerCase().replace(/\\d+/g, "N").replace(/['"\\\`]/g, "").replace(/\\s+/g, " ")
    .replace(/\\/[\\w\\-./]+\\.(ts|js|tsx|jsx)/g, "/FILE").trim();
}

function loadErrorDB() {
  if (!existsSync(ERRORS_DB)) return { version: "1.0.0", patterns: [], stats: { totalPatterns: 0, totalLookups: 0, successfulMatches: 0, lastUpdated: Date.now() } };
  try { return JSON.parse(readFileSync(ERRORS_DB, "utf-8")); } catch { return { version: "1.0.0", patterns: [], stats: { totalPatterns: 0, totalLookups: 0, successfulMatches: 0, lastUpdated: Date.now() } }; }
}

function detectErrorType(message) {
  const patterns = [{ regex: /TypeError/i, type: "TypeError" }, { regex: /SyntaxError/i, type: "SyntaxError" }, { regex: /Module not found/i, type: "ModuleNotFound" }, { regex: /build failed/i, type: "BuildError" }];
  for (const { regex, type } of patterns) if (regex.test(message)) return type;
  return "Error";
}

function detectTags(message) {
  const tags = [], lm = message.toLowerCase();
  if (lm.includes("typescript") || lm.includes(".ts")) tags.push("typescript");
  if (lm.includes("react") || lm.includes("jsx")) tags.push("react");
  if (lm.includes("node") || lm.includes("npm") || lm.includes("pnpm")) tags.push("node");
  if (lm.includes("build") || lm.includes("tsc")) tags.push("build");
  return tags;
}

function generateErrorId(norm, type) { return "err_" + crypto.createHash("sha256").update(type + ":" + norm).digest("hex").slice(0, 12); }

function addErrorToDB(errorMessage, solution, codeChanges) {
  const db = loadErrorDB();
  const errorType = detectErrorType(errorMessage);
  const normalizedMessage = normalizeError(errorMessage);
  const id = generateErrorId(normalizedMessage, errorType);
  if (db.patterns.find(p => p.id === id)) return null;
  const pattern = { id, errorType, errorMessage: errorMessage.slice(0, 500), normalizedMessage, context: {}, solution: { description: solution, steps: [], codeChanges: codeChanges || [], commands: [], preventionTips: [] }, metadata: { createdAt: Date.now(), lastUsed: Date.now(), useCount: 1, tags: detectTags(errorMessage), severity: "medium" } };
  db.patterns.push(pattern); db.stats.totalPatterns++; db.stats.lastUpdated = Date.now();
  writeFileSync(ERRORS_DB, JSON.stringify(db, null, 2));
  return pattern;
}

const pending = loadPending();
const errorPatterns = [/error:/i, /Error:/i, /failed/i, /Cannot find/i, /not found/i, /TypeError/, /SyntaxError/, /ENOENT/];

if (toolName === "Bash") {
  const command = toolInput.command || "";
  const output = toolResult.stdout || toolResult.stderr || "";
  const exitCode = toolResult.exit_code;
  const isError = exitCode !== 0 || errorPatterns.some(p => p.test(output));
  if (isError) {
    const errorMsg = extractErrorMessage(output);
    pending.errors.push({ command, errorMessage: errorMsg, normalizedError: normalizeError(errorMsg), timestamp: Date.now() });
    pending.errors = pending.errors.slice(-5);
    savePending(pending);
  } else {
    for (let i = pending.errors.length - 1; i >= 0; i--) {
      const pe = pending.errors[i];
      if (isSimilarCommand(pe.command, command)) {
        const recentEdits = pending.edits.filter(e => e.timestamp > pe.timestamp);
        if (recentEdits.length > 0) {
          const codeChanges = recentEdits.map(e => ({ file: e.file, before: e.oldString.slice(0, 200), after: e.newString.slice(0, 200) }));
          const filesChanged = [...new Set(recentEdits.map(e => e.file))];
          const solution = "Fixed by editing " + filesChanged.length + " file(s): " + filesChanged.map(f => f.split("/").pop()).join(", ");
          const added = addErrorToDB(pe.errorMessage, solution, codeChanges);
          pending.errors.splice(i, 1); pending.edits = []; savePending(pending);
          if (added) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", decision: "continue", reason: "✅ **Auto-learned error pattern!**\\n\\nError: \\\`" + pe.errorMessage.slice(0, 80) + "...\\\`\\nType: " + added.errorType + "\\nSolution: " + solution + "\\n\\nAdded to error DB." } }));
        }
        break;
      }
    }
  }
}

if (toolName === "Edit") {
  const file = toolInput.file_path || "";
  const oldString = toolInput.old_string || "";
  const newString = toolInput.new_string || "";
  if (pending.errors.length > 0 && oldString && newString) {
    pending.edits.push({ file, oldString, newString, timestamp: Date.now() });
    pending.edits = pending.edits.slice(-10);
    savePending(pending);
  }
}

const tenMinutes = 10 * 60 * 1000, now = Date.now();
pending.errors = pending.errors.filter(e => now - e.timestamp < tenMinutes);
pending.edits = pending.edits.filter(e => now - e.timestamp < tenMinutes);
savePending(pending);
`;
}

function getAutoTruncateHook() {
  return `#!/usr/bin/env node
import { readFileSync } from "fs";

const MAX_LINES = 150, HEAD_LINES = 50, TAIL_LINES = 20;

let input;
try { input = JSON.parse(readFileSync(0, "utf-8")); } catch { process.exit(0); }

if (input.tool_name !== "Read") process.exit(0);
const result = input.tool_result;
if (!result || typeof result !== "string") process.exit(0);

const lines = result.split("\\n");
if (lines.length <= MAX_LINES) process.exit(0);

const filePath = input.tool_input?.file_path || "file";
const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
if (![".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"].includes(ext)) process.exit(0);

const middleLines = lines.slice(HEAD_LINES, -TAIL_LINES);
const sigs = [];
for (const line of middleLines) {
  const c = line.replace(/^\\s*\\d+→\\s*/, "");
  if (/^(export\\s+)?(async\\s+)?function\\s+\\w+/.test(c) || /^(export\\s+)?class\\s+\\w+/.test(c) || /^(export\\s+)?(interface|type)\\s+\\w+/.test(c)) {
    const s = c.split("{")[0].split("=>")[0].trim();
    if (s.length > 10 && s.length < 150) sigs.push(s);
  }
}

let msg = "⚠️ **File truncated** (" + lines.length + " lines → " + (HEAD_LINES + TAIL_LINES) + " shown)\\n";
if (sigs.length) { msg += "Signatures: " + sigs.slice(0, 8).map(s => s.slice(0, 60)).join(", "); }
msg += "\\n💡 Use Read with offset/limit or \\\`rag:context --lazy\\\`";

console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", decision: "continue", reason: msg } }));
`;
}

// ============================================================
// SETTINGS
// ============================================================

function updateSettings() {
  const settingsPath = join(CLAUDE_DIR, "settings.json");
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { settings = {}; }
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
  settings.hooks.Stop = settings.hooks.Stop || [];

  const contextPath = escapePath(join(SCRIPTS_DIR, "rag-context-loader.js"));
  if (!settings.hooks.SessionStart.some(h => h.hooks?.some(hk => hk.command?.includes("rag-context-loader")))) {
    settings.hooks.SessionStart.push({ matcher: "", hooks: [{ type: "command", command: `node "${contextPath}"`, timeout: 30000 }] });
    console.log("✅ Added SessionStart hook");
  }

  const ragPath = escapePath(join(HOOKS_DIR, "suggest-rag.js"));
  if (!settings.hooks.PreToolUse.some(h => h.matcher === "Read")) {
    settings.hooks.PreToolUse.push({ matcher: "Read", hooks: [{ type: "command", command: `node "${ragPath}"` }] });
    console.log("✅ Added PreToolUse hook (RAG suggestion)");
  }

  const smartFilesPath = escapePath(join(HOOKS_DIR, "smart-files.js"));
  if (!settings.hooks.PreToolUse.some(h => h.matcher === "Edit" && h.hooks?.some(hk => hk.command?.includes("smart-files")))) {
    settings.hooks.PreToolUse.push({ matcher: "Edit", hooks: [{ type: "command", command: `node "${smartFilesPath}"` }] });
    console.log("✅ Added PreToolUse hook (smart files)");
  }

  const autoFixPath = escapePath(join(HOOKS_DIR, "auto-fix.js"));
  const errorLearnerPath = escapePath(join(HOOKS_DIR, "error-learner.js"));
  if (!settings.hooks.PostToolUse.some(h => h.hooks?.some(hk => hk.command?.includes("auto-fix")))) {
    settings.hooks.PostToolUse.push({ matcher: "Bash", hooks: [
      { type: "command", command: `node "${autoFixPath}"`, timeout: 10000 },
      { type: "command", command: `node "${errorLearnerPath}"`, timeout: 10000 }
    ] });
    console.log("✅ Added PostToolUse hook (auto-fix + error-learner)");
  }

  if (!settings.hooks.PostToolUse.some(h => h.matcher === "Edit" && h.hooks?.some(hk => hk.command?.includes("error-learner")))) {
    settings.hooks.PostToolUse.push({ matcher: "Edit", hooks: [{ type: "command", command: `node "${errorLearnerPath}"`, timeout: 5000 }] });
    console.log("✅ Added PostToolUse hook (error-learner for Edit)");
  }

  const autoTruncatePath = escapePath(join(HOOKS_DIR, "auto-truncate.js"));
  if (!settings.hooks.PostToolUse.some(h => h.hooks?.some(hk => hk.command?.includes("auto-truncate")))) {
    settings.hooks.PostToolUse.push({ matcher: "Read", hooks: [{ type: "command", command: `node "${autoTruncatePath}"` }] });
    console.log("✅ Added PostToolUse hook (auto-truncate)");
  }

  const sessionEndPath = escapePath(join(HOOKS_DIR, "session-end.js"));
  if (!settings.hooks.Stop.some(h => h.hooks?.some(hk => hk.command?.includes("session-end")))) {
    settings.hooks.Stop.push({ matcher: "", hooks: [{ type: "command", command: `node "${sessionEndPath}"`, timeout: 15000 }] });
    console.log("✅ Added Stop hook (session save)");
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log("✅ Updated settings.json");
}

// ============================================================
// INSTALL
// ============================================================

function install() {
  console.log("\n🚀 Installing Claude Toolkit v4.3\n");
  console.log(`Platform: ${platform()}`);
  console.log(`Project: ${PROJECT_ROOT}\n`);

  ensureDir(COMMANDS_DIR);
  ensureDir(SCRIPTS_DIR);
  ensureDir(HOOKS_DIR);

  writeCommand("rag", RAG_COMMAND);
  writeCommand("diff", DIFF_COMMAND);
  writeCommand("memory", MEMORY_COMMAND);
  writeCommand("session", SESSION_COMMAND);
  writeCommand("errors", ERRORS_COMMAND);
  writeCommand("snippets", SNIPPETS_COMMAND);

  writeScript("rag-context-loader.js", getContextLoaderScript());
  writeHook("suggest-rag.js", getSuggestRagHook());
  writeHook("on-error.js", getOnErrorHook());
  writeHook("session-end.js", getSessionEndHook());
  writeHook("smart-files.js", getSmartFilesHook());
  writeHook("auto-fix.js", getAutoFixHook());
  writeHook("auto-truncate.js", getAutoTruncateHook());
  writeHook("error-learner.js", getErrorLearnerHook());

  updateSettings();
  updateGitignore(PROJECT_ROOT);

  console.log("\n✨ Installation complete!\n");
  console.log("Commands: /rag, /diff, /memory, /session, /errors, /snippets");
  console.log("\nv4.3 Features:");
  console.log("  - Lazy loading: --lazy + rag:expand (max token savings)");
  console.log("  - Auto-truncate: large files auto-summarized");
  console.log("  - Session continuity (auto-load + auto-save)");
  console.log("  - Error pattern DB + auto-fix suggestions");
  console.log("  - Smart file watcher (related files on Edit)");
  console.log("\nHooks installed:");
  console.log("  - SessionStart: Load session context");
  console.log("  - Stop: Save session state");
  console.log("  - PostToolUse: Auto-fix + Auto-truncate");
  console.log("  - PreToolUse: RAG suggestion + Smart files");
  console.log("\nRun: pnpm rag:index && pnpm rag:install\n");
}

install();

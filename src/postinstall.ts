#!/usr/bin/env node
/**
 * Post-install script for Claude Toolkit
 * - Creates .rag directory
 * - Installs all hooks to .claude/hooks
 * - Adds scripts to package.json
 * - Updates .gitignore
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolkitRoot = join(__dirname, "..");
const projectRoot = join(toolkitRoot, "..", "..");

// Paths
const ragDir = join(projectRoot, ".rag");
const claudeHooksDir = join(projectRoot, ".claude", "hooks");
const hooksSourceDir = join(toolkitRoot, "hooks");

console.log("🔧 Claude Toolkit - Post-install setup\n");

// 1. Create .rag directory
if (!existsSync(ragDir)) {
  mkdirSync(ragDir, { recursive: true });
  console.log("✅ Created .rag/ directory");
} else {
  console.log("✓ .rag/ directory exists");
}

// 2. Install hooks
if (!existsSync(claudeHooksDir)) {
  mkdirSync(claudeHooksDir, { recursive: true });
}

const hooks = [
  "session-start.js",
  "session-end.js",
  "auto-fix.js",
  "auto-truncate.js",
  "read-guard.js",
  "budget-tracker.js",
  "smart-files.js",
  "on-error.js"
];

let hooksInstalled = 0;
for (const hook of hooks) {
  const source = join(hooksSourceDir, hook);
  const dest = join(claudeHooksDir, hook);
  if (existsSync(source)) {
    copyFileSync(source, dest);
    hooksInstalled++;
  }
}
console.log(`✅ Installed ${hooksInstalled} hooks to .claude/hooks/`);

// 3. Update .gitignore
const gitignorePath = join(projectRoot, ".gitignore");
const ragIgnoreEntry = ".rag/";
const legacyIgnoreEntry = ".rag-*.json";

if (existsSync(gitignorePath)) {
  let content = readFileSync(gitignorePath, "utf-8");
  let updated = false;

  if (!content.includes(ragIgnoreEntry)) {
    content += `\n# Claude Toolkit\n${ragIgnoreEntry}\n${legacyIgnoreEntry}\n.claude-memory.json\n`;
    updated = true;
  }

  if (updated) {
    writeFileSync(gitignorePath, content);
    console.log("✅ Updated .gitignore");
  } else {
    console.log("✓ .gitignore already configured");
  }
} else {
  writeFileSync(gitignorePath, `# Claude Toolkit\n${ragIgnoreEntry}\n${legacyIgnoreEntry}\n.claude-memory.json\n`);
  console.log("✅ Created .gitignore");
}

// 4. Check for package.json and suggest scripts
const packageJsonPath = join(projectRoot, "package.json");
if (existsSync(packageJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const hasRagScripts = pkg.scripts && Object.keys(pkg.scripts).some(k => k.startsWith("rag:"));

    if (!hasRagScripts) {
      console.log("\n💡 Add these scripts to your package.json:");
      console.log(`
"scripts": {
  "rag:index": "node plugins/claude-code-toolkit/dist/cli.js index -d .",
  "rag:context": "node plugins/claude-code-toolkit/dist/search.js context",
  "rag:expand": "node plugins/claude-code-toolkit/dist/search.js expand",
  "rag:deps": "node plugins/claude-code-toolkit/dist/search.js deps -d .",
  "rag:diff": "node plugins/claude-code-toolkit/dist/search.js diff -d .",
  "rag:commit": "node plugins/claude-code-toolkit/dist/search.js commit -d .",
  "rag:budget": "node plugins/claude-code-toolkit/dist/search.js budget -d .",
  "rag:hypothesis": "node plugins/claude-code-toolkit/dist/search.js hypothesis -d .",
  "rag:context-lock": "node plugins/claude-code-toolkit/dist/search.js context-lock -d .",
  "rag:optimizer": "node plugins/claude-code-toolkit/dist/search.js optimizer -d .",
  "rag:contracts": "node plugins/claude-code-toolkit/dist/search.js contracts -d .",
  "rag:locality": "node plugins/claude-code-toolkit/dist/search.js locality -d .",
  "rag:importance": "node plugins/claude-code-toolkit/dist/search.js importance -d .",
  "rag:risk": "node plugins/claude-code-toolkit/dist/search.js risk -d .",
  "rag:memory": "node plugins/claude-code-toolkit/dist/search.js memory -d .",
  "rag:session": "node plugins/claude-code-toolkit/dist/search.js session -d .",
  "rag:errors": "node plugins/claude-code-toolkit/dist/search.js errors -d .",
  "rag:snippets": "node plugins/claude-code-toolkit/dist/search.js snippets -d .",
  "rag:watch": "node plugins/claude-code-toolkit/dist/search.js watch -d ."
}`);
    } else {
      console.log("✓ rag: scripts already present");
    }
  } catch {
    // Ignore JSON parse errors
  }
}

console.log("\n✅ Setup complete!");
console.log("\nNext steps:");
console.log("  1. Run: pnpm rag:index");
console.log("  2. Search: pnpm rag:context \"your query\" --lazy");
console.log("  3. Check docs: plugins/claude-code-toolkit/CLAUDE.md");

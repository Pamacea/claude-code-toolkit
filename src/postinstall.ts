#!/usr/bin/env node
/**
 * Post-install script for Claude Toolkit
 * - Creates .rag directory
 * - Installs all hooks to .claude/hooks
 * - Adds scripts to package.json
 * - Updates .gitignore
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

interface HookConfig {
  type: "command";
  command: string;
  timeout: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookConfig[];
}

interface ClaudeSettings {
  permissions: {
    allow: string[];
    defaultMode: string;
  };
  hooks: {
    SessionStart?: HookMatcher[];
    Stop?: HookMatcher[];
    PreToolUse?: HookMatcher[];
    PostToolUse?: HookMatcher[];
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolkitRoot = join(__dirname, "..");
const claudeDir = join(toolkitRoot, "..");
const projectRoot = join(claudeDir, "..");

// Paths (toolkit is now at .claude/toolkit)
const ragDir = join(claudeDir, ".rag");
const claudeHooksDir = join(claudeDir, "hooks");
const hooksSourceDir = join(toolkitRoot, "hooks");

console.log("🔧 Claude Toolkit - Post-install setup\n");

// 1. Create .rag directory
if (!existsSync(ragDir)) {
  mkdirSync(ragDir, { recursive: true });
  console.log("✅ Created .claude/.rag/ directory");
} else {
  console.log("✓ .claude/.rag/ directory exists");
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
  "on-error.js",
  "error-learner.js"
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

// 2b. Configure hooks in settings.local.json
const settingsPath = join(projectRoot, ".claude", "settings.local.json");
let settings: ClaudeSettings = { permissions: { allow: [], defaultMode: "bypassPermissions" }, hooks: {} };

if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch { /* ignore parse errors */ }
}

// Ensure hooks configuration exists
if (!settings.hooks) settings.hooks = {};

// Configure all hook triggers
settings.hooks = {
  ...settings.hooks,
  SessionStart: [
    {
      hooks: [
        { type: "command", command: "node .claude/hooks/session-start.js", timeout: 180000 }
      ]
    }
  ],
  Stop: [
    {
      hooks: [
        { type: "command", command: "node .claude/hooks/session-end.js", timeout: 15000 }
      ]
    }
  ],
  PreToolUse: [
    {
      matcher: "Read",
      hooks: [
        { type: "command", command: "node .claude/hooks/read-guard.js", timeout: 5000 }
      ]
    },
    {
      matcher: "Edit",
      hooks: [
        { type: "command", command: "node .claude/hooks/smart-files.js", timeout: 5000 }
      ]
    }
  ],
  PostToolUse: [
    {
      matcher: "Bash",
      hooks: [
        { type: "command", command: "node .claude/hooks/auto-fix.js", timeout: 10000 },
        { type: "command", command: "node .claude/hooks/error-learner.js", timeout: 10000 }
      ]
    },
    {
      matcher: "Edit",
      hooks: [
        { type: "command", command: "node .claude/hooks/error-learner.js", timeout: 5000 }
      ]
    },
    {
      matcher: "Read",
      hooks: [
        { type: "command", command: "node .claude/hooks/auto-truncate.js", timeout: 5000 },
        { type: "command", command: "node .claude/hooks/budget-tracker.js", timeout: 5000 }
      ]
    }
  ]
};

writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log("✅ Configured hooks in .claude/settings.local.json");

// 3. Update .gitignore
const gitignorePath = join(projectRoot, ".gitignore");
const ragIgnoreEntry = ".claude/.rag/";
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
  "rag:index": "node .claude/toolkit/dist/cli.js index -d .",
  "rag:context": "node .claude/toolkit/dist/search.js context",
  "rag:expand": "node .claude/toolkit/dist/search.js expand",
  "rag:deps": "node .claude/toolkit/dist/search.js deps -d .",
  "rag:diff": "node .claude/toolkit/dist/search.js diff -d .",
  "rag:commit": "node .claude/toolkit/dist/search.js commit -d .",
  "rag:budget": "node .claude/toolkit/dist/search.js budget -d .",
  "rag:hypothesis": "node .claude/toolkit/dist/search.js hypothesis -d .",
  "rag:context-lock": "node .claude/toolkit/dist/search.js context-lock -d .",
  "rag:optimizer": "node .claude/toolkit/dist/search.js optimizer -d .",
  "rag:contracts": "node .claude/toolkit/dist/search.js contracts -d .",
  "rag:locality": "node .claude/toolkit/dist/search.js locality -d .",
  "rag:importance": "node .claude/toolkit/dist/search.js importance -d .",
  "rag:risk": "node .claude/toolkit/dist/search.js risk -d .",
  "rag:memory": "node .claude/toolkit/dist/search.js memory -d .",
  "rag:session": "node .claude/toolkit/dist/search.js session -d .",
  "rag:errors": "node .claude/toolkit/dist/search.js errors -d .",
  "rag:snippets": "node .claude/toolkit/dist/search.js snippets -d .",
  "rag:watch": "node .claude/toolkit/dist/search.js watch -d ."
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
console.log("  3. Check docs: .claude/toolkit/CLAUDE.md");

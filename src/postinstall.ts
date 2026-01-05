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
import { execSync } from "child_process";

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
const hooksSourceDir = join(toolkitRoot, "hooks");

console.log("🔧 Claude Toolkit - Post-install setup\n");

// 1. Create .rag directory
if (!existsSync(ragDir)) {
  mkdirSync(ragDir, { recursive: true });
  console.log("✅ Created .claude/.rag/ directory");
} else {
  console.log("✓ .claude/.rag/ directory exists");
}

// 2. Hooks are now used directly from toolkit/hooks
// No need to copy them to .claude/hooks/

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

// Configure all hook triggers - use hooks from toolkit directly
settings.hooks = {
  ...settings.hooks,
  SessionStart: [
    {
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/session-start.js", timeout: 180000 }
      ]
    }
  ],
  Stop: [
    {
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/session-end.js", timeout: 15000 }
      ]
    }
  ],
  PreToolUse: [
    {
      matcher: "Read",
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/read-guard.js", timeout: 5000 }
      ]
    },
    {
      matcher: "Edit",
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/smart-files.js", timeout: 5000 }
      ]
    }
  ],
  PostToolUse: [
    {
      matcher: "Bash",
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/auto-fix.js", timeout: 10000 },
        { type: "command", command: "node .claude/toolkit/hooks/error-learner.js", timeout: 10000 }
      ]
    },
    {
      matcher: "Edit",
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/error-learner.js", timeout: 5000 }
      ]
    },
    {
      matcher: "Read",
      hooks: [
        { type: "command", command: "node .claude/toolkit/hooks/auto-truncate.js", timeout: 5000 },
        { type: "command", command: "node .claude/toolkit/hooks/budget-tracker.js", timeout: 5000 }
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

// 4. Automatically add scripts to package.json
const packageJsonPath = join(projectRoot, "package.json");
const addScriptsPath = join(toolkitRoot, "add-scripts.js");

if (existsSync(packageJsonPath) && existsSync(addScriptsPath)) {
  try {
    execSync(`node "${addScriptsPath}"`, { cwd: projectRoot, stdio: "inherit" });
  } catch {
    // Ignore errors - scripts might already exist
  }
}

console.log("\n✅ Setup complete!");
console.log("\nNext steps:");
console.log("  1. Run: pnpm rag:index");
console.log("  2. Search: pnpm rag:context \"your query\" --lazy");
console.log("  3. Check docs: .claude/toolkit/CLAUDE.md");

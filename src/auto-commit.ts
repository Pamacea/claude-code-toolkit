/**
 * Auto-Commit Messages - Generate commit messages from git diff
 *
 * Analyzes git diff and generates conventional commit messages.
 * Saves 100% of commit message writing time.
 */

import { execSync } from "child_process";
import { getDiffContext, getDiffStats, getChangedFiles, type DiffSummary } from "./diff-context.js";

export interface CommitSuggestion {
  type: CommitType;
  scope: string | null;
  subject: string;
  body: string[];
  breaking: boolean;
  fullMessage: string;
  confidence: number;
}

export type CommitType =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert";

interface FileAnalysis {
  path: string;
  type: "added" | "modified" | "deleted" | "renamed";
  category: FileCategory;
  changes: string[];
}

type FileCategory =
  | "component"
  | "hook"
  | "util"
  | "type"
  | "test"
  | "config"
  | "docs"
  | "style"
  | "build"
  | "other";

/**
 * Analyze a file path to determine its category
 */
function categorizeFile(filePath: string): FileCategory {
  const lower = filePath.toLowerCase();
  const filename = filePath.split("/").pop() || "";

  // Tests
  if (lower.includes(".test.") || lower.includes(".spec.") || lower.includes("__tests__")) {
    return "test";
  }

  // Docs
  if (lower.endsWith(".md") || lower.includes("/docs/")) {
    return "docs";
  }

  // Config files
  if (
    filename.startsWith(".") ||
    filename.includes("config") ||
    ["package.json", "tsconfig.json", "vite.config.ts", "eslint.config.js"].includes(filename)
  ) {
    return "config";
  }

  // Build/CI
  if (
    lower.includes("dockerfile") ||
    lower.includes(".yml") ||
    lower.includes(".yaml") ||
    lower.includes("/ci/") ||
    lower.includes("/.github/")
  ) {
    return "build";
  }

  // Styles
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) {
    return "style";
  }

  // Types
  if (lower.includes("/types/") || lower.endsWith(".d.ts") || filename.startsWith("types")) {
    return "type";
  }

  // Hooks
  if (lower.includes("/hooks/") || filename.startsWith("use")) {
    return "hook";
  }

  // Components
  if (lower.includes("/components/") || (lower.endsWith(".tsx") && /^[A-Z]/.test(filename))) {
    return "component";
  }

  // Utils
  if (lower.includes("/utils/") || lower.includes("/helpers/") || lower.includes("/lib/")) {
    return "util";
  }

  return "other";
}

/**
 * Extract meaningful changes from diff content
 */
function extractChanges(diffContent: string): string[] {
  const changes: string[] = [];
  const lines = diffContent.split("\n");

  for (const line of lines) {
    // Added lines (excluding just whitespace changes)
    if (line.startsWith("+") && !line.startsWith("+++") && line.trim().length > 3) {
      const content = line.slice(1).trim();

      // Function/method additions
      if (content.match(/^(export\s+)?(async\s+)?function\s+\w+/)) {
        const match = content.match(/function\s+(\w+)/);
        if (match) changes.push(`add function ${match[1]}`);
      }
      // Component additions
      else if (content.match(/^(export\s+)?(const|function)\s+[A-Z]\w+/)) {
        const match = content.match(/(const|function)\s+([A-Z]\w+)/);
        if (match) changes.push(`add component ${match[2]}`);
      }
      // Interface/type additions
      else if (content.match(/^(export\s+)?(interface|type)\s+\w+/)) {
        const match = content.match(/(interface|type)\s+(\w+)/);
        if (match) changes.push(`add ${match[1]} ${match[2]}`);
      }
      // Import additions
      else if (content.match(/^import\s+/)) {
        const match = content.match(/from\s+["']([^"']+)["']/);
        if (match) changes.push(`import from ${match[1]}`);
      }
    }

    // Removed lines
    if (line.startsWith("-") && !line.startsWith("---") && line.trim().length > 3) {
      const content = line.slice(1).trim();

      if (content.match(/^(export\s+)?(async\s+)?function\s+\w+/)) {
        const match = content.match(/function\s+(\w+)/);
        if (match) changes.push(`remove function ${match[1]}`);
      }
    }
  }

  return [...new Set(changes)].slice(0, 10);
}

/**
 * Determine commit type from file changes
 */
function inferCommitType(files: FileAnalysis[], diffSummary: DiffSummary): CommitType {
  const categories = files.map((f) => f.category);
  const allChanges = files.flatMap((f) => f.changes);

  // Pure test changes
  if (categories.every((c) => c === "test")) {
    return "test";
  }

  // Pure docs changes
  if (categories.every((c) => c === "docs")) {
    return "docs";
  }

  // Pure style changes
  if (categories.every((c) => c === "style")) {
    return "style";
  }

  // Config/build changes
  if (categories.every((c) => c === "config" || c === "build")) {
    return "chore";
  }

  // Check for bug fixes (keywords in changes or file names)
  const hasFix = allChanges.some((c) =>
    /fix|bug|issue|error|crash|patch/i.test(c)
  ) || files.some((f) => /fix/i.test(f.path));

  if (hasFix) {
    return "fix";
  }

  // Check for new features (new files or new exports)
  const hasNewExports = allChanges.some((c) => c.startsWith("add "));
  const hasNewFiles = files.some((f) => f.type === "added");

  if (hasNewExports || hasNewFiles) {
    return "feat";
  }

  // Refactoring (modifications without new features)
  const onlyModifications = files.every((f) => f.type === "modified");
  if (onlyModifications && !hasNewExports) {
    return "refactor";
  }

  return "feat";
}

/**
 * Infer scope from file paths
 */
function inferScope(files: FileAnalysis[]): string | null {
  if (files.length === 0) return null;

  // Check for package scope (monorepo)
  const packageMatches = files.map((f) => f.path.match(/packages\/([^/]+)/));
  const packages = [...new Set(packageMatches.filter(Boolean).map((m) => m![1]))];

  if (packages.length === 1) {
    return packages[0];
  }

  // Check for directory scope
  const dirs = files.map((f) => {
    const parts = f.path.split("/");
    if (parts.length >= 2) {
      // Skip common prefixes
      if (["src", "lib", "packages"].includes(parts[0])) {
        return parts[1];
      }
      return parts[0];
    }
    return null;
  }).filter(Boolean);

  const uniqueDirs = [...new Set(dirs)];
  if (uniqueDirs.length === 1) {
    return uniqueDirs[0] as string;
  }

  // Multiple scopes
  if (packages.length > 1) {
    return packages.join(",");
  }

  return null;
}

/**
 * Generate commit subject from changes
 */
function generateSubject(
  type: CommitType,
  scope: string | null,
  files: FileAnalysis[]
): string {
  const allChanges = files.flatMap((f) => f.changes);

  // Try to create a meaningful subject from changes
  if (allChanges.length > 0) {
    // Group similar changes
    const adds = allChanges.filter((c) => c.startsWith("add "));
    const removes = allChanges.filter((c) => c.startsWith("remove "));

    if (adds.length > 0 && removes.length === 0) {
      if (adds.length === 1) {
        return adds[0];
      }
      return `add ${adds.length} new items`;
    }

    if (removes.length > 0 && adds.length === 0) {
      return `remove ${removes.length} items`;
    }

    if (adds.length > 0 && removes.length > 0) {
      return `refactor with ${adds.length} additions and ${removes.length} removals`;
    }
  }

  // Fallback to file-based subject
  if (files.length === 1) {
    const file = files[0];
    const filename = file.path.split("/").pop()?.replace(/\.[^.]+$/, "") || "file";

    switch (file.type) {
      case "added":
        return `add ${filename}`;
      case "deleted":
        return `remove ${filename}`;
      case "renamed":
        return `rename ${filename}`;
      default:
        return `update ${filename}`;
    }
  }

  // Multiple files
  const categories = [...new Set(files.map((f) => f.category))];

  if (categories.length === 1) {
    return `update ${categories[0]}s`;
  }

  return `update ${files.length} files`;
}

/**
 * Generate commit body from changes
 */
function generateBody(
  files: FileAnalysis[],
  stats: { files: number; insertions: number; deletions: number }
): string[] {
  const body: string[] = [];

  // List changed files by category
  const byCategory = new Map<FileCategory, FileAnalysis[]>();
  for (const file of files) {
    const existing = byCategory.get(file.category) || [];
    existing.push(file);
    byCategory.set(file.category, existing);
  }

  for (const [category, categoryFiles] of byCategory) {
    if (categoryFiles.length === 1) {
      const f = categoryFiles[0];
      const status = f.type === "added" ? "+" : f.type === "deleted" ? "-" : "~";
      body.push(`${status} ${f.path}`);
    } else {
      body.push(`${category}: ${categoryFiles.length} files`);
    }
  }

  // Add stats
  if (stats.insertions > 0 || stats.deletions > 0) {
    body.push("");
    body.push(`Changes: +${stats.insertions}/-${stats.deletions}`);
  }

  return body;
}

/**
 * Generate commit message suggestion from git diff
 */
export function generateCommitMessage(rootDir: string, staged: boolean = true): CommitSuggestion {
  const diffSummary = getDiffContext(rootDir, { staged });
  const stats = getDiffStats(rootDir, { staged });

  // Analyze each file
  const files: FileAnalysis[] = diffSummary.files.map((file) => ({
    path: file.filePath,
    type: file.status as FileAnalysis["type"],
    category: categorizeFile(file.filePath),
    changes: extractChanges(file.hunks.map((h) => h.content).join("\n")),
  }));

  // Infer commit details
  const type = inferCommitType(files, diffSummary);
  const scope = inferScope(files);
  const subject = generateSubject(type, scope, files);
  const body = generateBody(files, stats);

  // Build full message
  const header = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
  const fullMessage = [header, "", ...body].join("\n");

  // Calculate confidence
  let confidence = 0.5;
  if (files.length === 1) confidence += 0.2;
  if (files.every((f) => f.category !== "other")) confidence += 0.15;
  if (files.flatMap((f) => f.changes).length > 0) confidence += 0.15;

  return {
    type,
    scope,
    subject,
    body,
    breaking: false,
    fullMessage,
    confidence: Math.min(confidence, 1),
  };
}

/**
 * Format commit suggestion for CLI output
 */
export function formatCommitSuggestion(suggestion: CommitSuggestion): string {
  const confidenceBar = "█".repeat(Math.round(suggestion.confidence * 10)) +
    "░".repeat(10 - Math.round(suggestion.confidence * 10));

  let output = `\n💬 Suggested Commit Message\n`;
  output += `   Confidence: [${confidenceBar}] ${(suggestion.confidence * 100).toFixed(0)}%\n\n`;

  output += `┌─────────────────────────────────────────────────\n`;
  output += `│ ${suggestion.type}${suggestion.scope ? `(${suggestion.scope})` : ""}: ${suggestion.subject}\n`;

  if (suggestion.body.length > 0) {
    output += `│\n`;
    for (const line of suggestion.body) {
      output += `│ ${line}\n`;
    }
  }

  output += `└─────────────────────────────────────────────────\n`;

  return output;
}

/**
 * Get git command to execute the commit
 */
export function getCommitCommand(suggestion: CommitSuggestion): string {
  const escapedMessage = suggestion.fullMessage
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");

  return `git commit -m "${escapedMessage}"`;
}

/**
 * Execute the commit
 */
export function executeCommit(rootDir: string, suggestion: CommitSuggestion): boolean {
  try {
    const message = suggestion.fullMessage;

    // Use heredoc for multiline message
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: rootDir,
      stdio: "inherit",
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if there are staged changes
 */
export function hasStagedChanges(rootDir: string): boolean {
  try {
    const result = execSync("git diff --cached --name-only", {
      cwd: rootDir,
      encoding: "utf-8",
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if there are unstaged changes
 */
export function hasUnstagedChanges(rootDir: string): boolean {
  try {
    const result = execSync("git diff --name-only", {
      cwd: rootDir,
      encoding: "utf-8",
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

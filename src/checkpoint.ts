/**
 * Checkpoint Module - Compressed Session State (CSS) Generator
 *
 * Generates ultra-compact session state for context transfer across sessions.
 * Enables "consciousness transfer" when starting new conversations with /new.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { loadSession, type SessionSummary } from "./session-summary.js";
import { loadBudget, type ReadBudget, getBudgetStats } from "./read-optimizer.js";
import { loadGraph } from "./dependency-graph.js";
import { getChangedFiles, getCurrentBranch } from "./diff-context.js";
import { getRagPath, ensureRagDir } from "./paths.js";

export interface CheckpointData {
  version: string;
  createdAt: string;
  branch: string;
  architecture: ArchitectureDecision[];
  wipFiles: WipFile[];
  todoStack: TodoItem[];
  contextSnapshot: ContextSnapshot;
  budgetSummary: BudgetSummary;
}

export interface ArchitectureDecision {
  category: string;
  decision: string;
  rationale?: string;
}

export interface WipFile {
  path: string;
  status: "modified" | "added" | "deleted";
  summary: string;
  linesChanged: number;
}

export interface TodoItem {
  priority: number;
  task: string;
  status: "pending" | "in_progress" | "blocked";
  context?: string;
}

export interface ContextSnapshot {
  keyFiles: string[];
  recentReads: string[];
  hotspots: string[];
}

export interface BudgetSummary {
  consumed: number;
  budget: number;
  percentUsed: number;
  topConsumers: string[];
}

const CHECKPOINT_VERSION = "1.0.0";

/**
 * Load checkpoint from disk
 */
export function loadCheckpoint(rootDir: string): CheckpointData | null {
  const checkpointPath = getCheckpointPath(rootDir);
  if (!fs.existsSync(checkpointPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(checkpointPath, "utf-8")) as CheckpointData;
  } catch {
    return null;
  }
}

/**
 * Save checkpoint to disk
 */
export function saveCheckpoint(rootDir: string, checkpoint: CheckpointData): void {
  ensureRagDir(rootDir);
  const checkpointPath = getCheckpointPath(rootDir);
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

  const claudeDir = path.join(rootDir, ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  const lastCheckpointPath = path.join(claudeDir, "last_checkpoint.md");
  fs.writeFileSync(lastCheckpointPath, formatCheckpointMarkdown(checkpoint));
}

/**
 * Get checkpoint file path
 */
export function getCheckpointPath(rootDir: string): string {
  return getRagPath(rootDir, "CHECKPOINT");
}

/**
 * Generate checkpoint from current session state
 */
export function generateCheckpoint(
  rootDir: string,
  options: {
    architecture?: ArchitectureDecision[];
    todos?: TodoItem[];
    customContext?: string;
  } = {}
): CheckpointData {
  const session = loadSession(rootDir);
  const budget = loadBudget(rootDir);
  const branch = getCurrentBranch(rootDir);
  const changedFiles = getChangedFiles(rootDir, {});

  const wipFiles: WipFile[] = changedFiles.map(file => ({
    path: file,
    status: detectFileStatus(rootDir, file),
    summary: generateFileSummary(rootDir, file),
    linesChanged: countFileLinesChanged(rootDir, file),
  }));

  const budgetSummary = budget ? generateBudgetSummary(budget) : {
    consumed: 0,
    budget: 50000,
    percentUsed: 0,
    topConsumers: [],
  };

  const contextSnapshot = generateContextSnapshot(rootDir, session);

  return {
    version: CHECKPOINT_VERSION,
    createdAt: new Date().toISOString(),
    branch,
    architecture: options.architecture || [],
    wipFiles,
    todoStack: options.todos || extractTodosFromSession(session),
    contextSnapshot,
    budgetSummary,
  };
}

/**
 * Detect file status from git
 */
function detectFileStatus(rootDir: string, file: string): WipFile["status"] {
  try {
    const status = execSync(`git status --porcelain "${file}"`, {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    if (status.startsWith("A") || status.startsWith("?")) return "added";
    if (status.startsWith("D")) return "deleted";
    return "modified";
  } catch {
    return "modified";
  }
}

/**
 * Generate compact file summary
 */
function generateFileSummary(rootDir: string, file: string): string {
  try {
    const diff = execSync(`git diff --stat "${file}"`, {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    const lines = diff.split("\n");
    return lines[lines.length - 1] || "No changes";
  } catch {
    return "Unable to generate summary";
  }
}

/**
 * Count lines changed for a file
 */
function countFileLinesChanged(rootDir: string, file: string): number {
  try {
    const stat = execSync(`git diff --numstat "${file}"`, {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    const match = stat.match(/^(\d+)\s+(\d+)/);
    if (match) {
      return parseInt(match[1]) + parseInt(match[2]);
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Generate budget summary
 */
function generateBudgetSummary(budget: ReadBudget): BudgetSummary {
  const stats = getBudgetStats(budget);
  return {
    consumed: stats.consumed,
    budget: stats.budget,
    percentUsed: stats.percentUsed,
    topConsumers: stats.topFiles.slice(0, 3).map(f => f.path),
  };
}

/**
 * Generate context snapshot
 */
function generateContextSnapshot(rootDir: string, session: SessionSummary | null): ContextSnapshot {
  const keyFiles: string[] = [];
  const recentReads: string[] = [];
  const hotspots: string[] = [];

  if (session?.actions) {
    for (const action of session.actions.slice(-20)) {
      if (action.type === "file_read" && action.files) {
        recentReads.push(...action.files);
      }
      if (action.type === "file_edit" && action.files) {
        hotspots.push(...action.files);
      }
    }
  }

  try {
    const graph = loadGraph(rootDir);
    if (graph) {
      const entries = Object.entries(graph.nodes)
        .filter(([_, node]) => node.isEntryPoint)
        .map(([file]) => file)
        .slice(0, 5);
      keyFiles.push(...entries);
    }
  } catch { /* ignore errors */ }

  return {
    keyFiles: [...new Set(keyFiles)].slice(0, 5),
    recentReads: [...new Set(recentReads)].slice(0, 10),
    hotspots: [...new Set(hotspots)].slice(0, 5),
  };
}

/**
 * Extract TODOs from session actions
 */
function extractTodosFromSession(session: SessionSummary | null): TodoItem[] {
  if (!session?.actions) return [];

  const todos: TodoItem[] = [];
  let priority = 1;

  for (const action of session.actions.slice(-10).reverse()) {
    if (action.type === "file_edit" && action.description.toLowerCase().includes("todo")) {
      todos.push({
        priority: priority++,
        task: action.description,
        status: "pending",
        context: action.files?.[0],
      });
    }
  }

  return todos;
}

/**
 * Format checkpoint as compressed markdown
 */
export function formatCheckpointMarkdown(checkpoint: CheckpointData): string {
  const lines: string[] = [
    "# Session Checkpoint (CSS)",
    "",
    `> Created: ${new Date(checkpoint.createdAt).toLocaleString()}`,
    `> Branch: \`${checkpoint.branch}\``,
    `> Budget: ${checkpoint.budgetSummary.percentUsed}% used`,
    "",
  ];

  if (checkpoint.architecture.length > 0) {
    lines.push("## [ARCH] Architecture Decisions");
    for (const arch of checkpoint.architecture) {
      lines.push(`- **${arch.category}**: ${arch.decision}`);
      if (arch.rationale) {
        lines.push(`  └─ ${arch.rationale}`);
      }
    }
    lines.push("");
  }

  if (checkpoint.wipFiles.length > 0) {
    lines.push("## [WIP] Work in Progress");
    for (const wip of checkpoint.wipFiles) {
      const icon = wip.status === "added" ? "➕" : wip.status === "deleted" ? "➖" : "📝";
      lines.push(`- ${icon} \`${wip.path}\` (+${wip.linesChanged})`);
    }
    lines.push("");
  }

  if (checkpoint.todoStack.length > 0) {
    lines.push("## [TODO] Task Stack");
    for (const todo of checkpoint.todoStack) {
      const status = todo.status === "in_progress" ? "🔄" : todo.status === "blocked" ? "🚫" : "⬜";
      lines.push(`${todo.priority}. ${status} ${todo.task}`);
      if (todo.context) {
        lines.push(`   └─ Context: \`${todo.context}\``);
      }
    }
    lines.push("");
  }

  if (checkpoint.contextSnapshot.hotspots.length > 0) {
    lines.push("## [CTX] Hot Files");
    for (const file of checkpoint.contextSnapshot.hotspots) {
      lines.push(`- \`${file}\``);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("*Load with: Check `.claude/last_checkpoint.md` after `/new`*");

  return lines.join("\n");
}

/**
 * Format checkpoint as compact CLI output
 */
export function formatCheckpointCli(checkpoint: CheckpointData): string {
  let output = "\n📦 Checkpoint Generated\n\n";

  output += `Branch: ${checkpoint.branch}\n`;
  output += `Budget: ${checkpoint.budgetSummary.percentUsed}% (${checkpoint.budgetSummary.consumed}/${checkpoint.budgetSummary.budget})\n\n`;

  if (checkpoint.wipFiles.length > 0) {
    output += `[WIP] ${checkpoint.wipFiles.length} files in progress:\n`;
    for (const wip of checkpoint.wipFiles.slice(0, 5)) {
      output += `  • ${wip.path} (${wip.status})\n`;
    }
    output += "\n";
  }

  if (checkpoint.todoStack.length > 0) {
    output += `[TODO] ${checkpoint.todoStack.length} tasks:\n`;
    for (const todo of checkpoint.todoStack.slice(0, 5)) {
      output += `  ${todo.priority}. ${todo.task}\n`;
    }
    output += "\n";
  }

  output += `✅ Saved to .claude/last_checkpoint.md\n`;
  output += `📋 Copied to clipboard (use after /new)\n`;

  return output;
}

/**
 * Copy checkpoint to clipboard (cross-platform)
 */
export function copyToClipboard(content: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync("pbcopy", { input: content });
    } else if (platform === "win32") {
      execSync("clip", { input: content });
    } else {
      execSync("xclip -selection clipboard", { input: content });
    }
    return true;
  } catch {
    return false;
  }
}

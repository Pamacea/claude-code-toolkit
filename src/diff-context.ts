import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

export interface DiffHunk {
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  additions: string[];
  deletions: string[];
  context: string[];
}

export interface DiffFile {
  filePath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  oldPath?: string; // For renames
}

export interface DiffSummary {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  affectedFunctions: string[];
}

/**
 * Get git diff between two refs (or working tree)
 */
export function getGitDiff(
  rootDir: string,
  options: {
    base?: string; // Base ref (default: HEAD)
    target?: string; // Target ref (default: working tree)
    staged?: boolean; // Only staged changes
    unified?: number; // Context lines (default: 3)
  } = {}
): string {
  const { base = "HEAD", target, staged = false, unified = 3 } = options;

  let cmd = `git diff -U${unified}`;

  if (staged) {
    cmd += " --staged";
  } else if (target) {
    cmd += ` ${base}..${target}`;
  } else {
    cmd += ` ${base}`;
  }

  try {
    return execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
  } catch (error: any) {
    if (error.stdout) return error.stdout;
    return "";
  }
}

/**
 * Parse unified diff output into structured format
 */
export function parseDiff(diffOutput: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  const hunkRegex = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)$/gm;

  // Split by file
  const fileSections = diffOutput.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    const headerMatch = lines[0].match(/a\/(.+) b\/(.+)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

    // Determine status
    let status: DiffFile["status"] = "modified";
    if (section.includes("new file mode")) {
      status = "added";
    } else if (section.includes("deleted file mode")) {
      status = "deleted";
    } else if (oldPath !== newPath) {
      status = "renamed";
    }

    const file: DiffFile = {
      filePath: newPath,
      status,
      hunks: [],
      oldPath: status === "renamed" ? oldPath : undefined,
    };

    // Parse hunks
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);

      if (hunkMatch) {
        if (currentHunk) {
          file.hunks.push(currentHunk);
        }

        currentHunk = {
          filePath: newPath,
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2]) || 1,
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4]) || 1,
          content: hunkMatch[5].trim(), // Function context from @@ line
          additions: [],
          deletions: [],
          context: [],
        };
      } else if (currentHunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentHunk.additions.push(line.slice(1));
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          currentHunk.deletions.push(line.slice(1));
        } else if (line.startsWith(" ")) {
          currentHunk.context.push(line.slice(1));
        }
      }
    }

    if (currentHunk) {
      file.hunks.push(currentHunk);
    }

    files.push(file);
  }

  return files;
}

/**
 * Extract affected function/class names from hunks
 */
export function extractAffectedSymbols(hunks: DiffHunk[]): string[] {
  const symbols = new Set<string>();

  // Patterns to detect function/class definitions
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /(?:export\s+)?class\s+(\w+)/,
    /(?:export\s+)?const\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=])\s*=>/,
    /(?:export\s+)?interface\s+(\w+)/,
    /(?:export\s+)?type\s+(\w+)/,
  ];

  for (const hunk of hunks) {
    // Check hunk header (git often includes function name)
    if (hunk.content) {
      for (const pattern of patterns) {
        const match = hunk.content.match(pattern);
        if (match) {
          symbols.add(match[1]);
        }
      }
    }

    // Check additions and context
    const allLines = [...hunk.additions, ...hunk.context, ...hunk.deletions];
    for (const line of allLines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          symbols.add(match[1]);
        }
      }
    }
  }

  return Array.from(symbols);
}

/**
 * Get minimal context for a diff (only changed parts + signatures)
 */
export function getDiffContext(
  rootDir: string,
  options: {
    base?: string;
    target?: string;
    staged?: boolean;
    includeContext?: boolean; // Include surrounding context lines
  } = {}
): DiffSummary {
  const { includeContext = true } = options;

  const diffOutput = getGitDiff(rootDir, {
    ...options,
    unified: includeContext ? 3 : 0,
  });

  const files = parseDiff(diffOutput);

  let totalAdditions = 0;
  let totalDeletions = 0;
  const allSymbols: string[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      totalAdditions += hunk.additions.length;
      totalDeletions += hunk.deletions.length;
    }
    allSymbols.push(...extractAffectedSymbols(file.hunks));
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
    affectedFunctions: [...new Set(allSymbols)],
  };
}

/**
 * Format diff as minimal context for Claude
 */
export function formatDiffContext(
  summary: DiffSummary,
  options: {
    maxLines?: number;
    showFullHunks?: boolean;
  } = {}
): string {
  const { maxLines = 500, showFullHunks = true } = options;

  let output = `<diff-context files="${summary.files.length}" additions="${summary.totalAdditions}" deletions="${summary.totalDeletions}">\n`;

  if (summary.affectedFunctions.length > 0) {
    output += `\n<affected-symbols>${summary.affectedFunctions.join(", ")}</affected-symbols>\n`;
  }

  let lineCount = 0;

  for (const file of summary.files) {
    if (lineCount >= maxLines) {
      output += `\n<!-- Truncated: ${summary.files.length - summary.files.indexOf(file)} more files -->\n`;
      break;
    }

    output += `\n<file path="${file.filePath}" status="${file.status}"`;
    if (file.oldPath) {
      output += ` old-path="${file.oldPath}"`;
    }
    output += `>\n`;

    for (const hunk of file.hunks) {
      if (lineCount >= maxLines) break;

      output += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
      if (hunk.content) {
        output += ` ${hunk.content}`;
      }
      output += "\n";

      if (showFullHunks) {
        // Show deletions
        for (const line of hunk.deletions) {
          output += `-${line}\n`;
          lineCount++;
        }
        // Show additions
        for (const line of hunk.additions) {
          output += `+${line}\n`;
          lineCount++;
        }
      } else {
        // Summary only
        if (hunk.deletions.length > 0) {
          output += `  [-${hunk.deletions.length} lines]\n`;
        }
        if (hunk.additions.length > 0) {
          output += `  [+${hunk.additions.length} lines]\n`;
        }
      }
    }

    output += `</file>\n`;
  }

  output += `\n</diff-context>`;
  return output;
}

/**
 * Get list of changed files (paths only)
 */
export function getChangedFiles(
  rootDir: string,
  options: {
    base?: string;
    target?: string;
    staged?: boolean;
  } = {}
): string[] {
  const { base = "HEAD", target, staged = false } = options;

  let cmd = "git diff --name-only";

  if (staged) {
    cmd += " --staged";
  } else if (target) {
    cmd += ` ${base}..${target}`;
  } else {
    cmd += ` ${base}`;
  }

  try {
    const output = execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check if a file has uncommitted changes
 */
export function hasUncommittedChanges(rootDir: string, filePath: string): boolean {
  try {
    const output = execSync(`git status --porcelain "${filePath}"`, {
      cwd: rootDir,
      encoding: "utf-8",
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(rootDir: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Get diff stats (quick summary)
 */
export function getDiffStats(
  rootDir: string,
  options: {
    base?: string;
    target?: string;
    staged?: boolean;
  } = {}
): { files: number; insertions: number; deletions: number } {
  const { base = "HEAD", target, staged = false } = options;

  let cmd = "git diff --shortstat";

  if (staged) {
    cmd += " --staged";
  } else if (target) {
    cmd += ` ${base}..${target}`;
  } else {
    cmd += ` ${base}`;
  }

  try {
    const output = execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();

    const filesMatch = output.match(/(\d+) files? changed/);
    const insertMatch = output.match(/(\d+) insertions?\(\+\)/);
    const deleteMatch = output.match(/(\d+) deletions?\(-\)/);

    return {
      files: filesMatch ? parseInt(filesMatch[1]) : 0,
      insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
      deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0,
    };
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

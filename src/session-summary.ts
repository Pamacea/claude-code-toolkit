import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getCurrentBranch, getChangedFiles, getDiffStats } from "./diff-context.js";
import { getRagPath, ensureRagDir } from "./paths.js";

export interface SessionAction {
  timestamp: number;
  type: "file_read" | "file_edit" | "search" | "commit" | "build" | "test" | "other";
  description: string;
  files?: string[];
}

export interface SessionSummary {
  version: string;
  sessionId: string;
  startedAt: number;
  lastUpdated: number;
  branch: string;
  commits: CommitInfo[];
  modifiedFiles: string[];
  actions: SessionAction[];
  workContext: string;
  stats: SessionStats;
}

export interface CommitInfo {
  hash: string;
  message: string;
  timestamp: number;
  filesChanged: number;
}

export interface SessionStats {
  totalActions: number;
  filesRead: number;
  filesEdited: number;
  searchesPerformed: number;
  commitsCreated: number;
}

const SESSION_VERSION = "1.0.0";

/**
 * Get session file path
 */
export function getSessionPath(rootDir: string): string {
  return getRagPath(rootDir, "SESSION");
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Load existing session or create new one
 */
export function loadSession(rootDir: string): SessionSummary | null {
  const sessionPath = getSessionPath(rootDir);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(sessionPath, "utf-8");
    const session = JSON.parse(data) as SessionSummary;

    if (session.version !== SESSION_VERSION) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Save session to disk
 */
export function saveSession(rootDir: string, session: SessionSummary): void {
  ensureRagDir(rootDir);
  const sessionPath = getSessionPath(rootDir);
  session.lastUpdated = Date.now();
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
}

/**
 * Create a new session
 */
export function createSession(rootDir: string): SessionSummary {
  const branch = getCurrentBranch(rootDir);
  const commits = getRecentCommits(rootDir, 10);
  const modifiedFiles = getChangedFiles(rootDir, {});

  return {
    version: SESSION_VERSION,
    sessionId: generateSessionId(),
    startedAt: Date.now(),
    lastUpdated: Date.now(),
    branch,
    commits,
    modifiedFiles,
    actions: [],
    workContext: "",
    stats: {
      totalActions: 0,
      filesRead: 0,
      filesEdited: 0,
      searchesPerformed: 0,
      commitsCreated: 0,
    },
  };
}

/**
 * Get recent commits from git
 */
export function getRecentCommits(rootDir: string, count: number = 10): CommitInfo[] {
  try {
    const output = execSync(
      `git log -${count} --format="%H|%s|%at|%cs" --shortstat`,
      { cwd: rootDir, encoding: "utf-8" }
    );

    const commits: CommitInfo[] = [];
    const lines = output.trim().split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes("|")) {
        const [hash, message, timestamp] = line.split("|");
        let filesChanged = 0;

        // Look for stats in next line
        if (i + 1 < lines.length && lines[i + 1].includes("file")) {
          const statsMatch = lines[i + 1].match(/(\d+) files? changed/);
          if (statsMatch) {
            filesChanged = parseInt(statsMatch[1]);
          }
        }

        commits.push({
          hash: hash.slice(0, 7),
          message: message.slice(0, 80),
          timestamp: parseInt(timestamp) * 1000,
          filesChanged,
        });
      }
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Record an action in the session
 */
export function recordAction(
  session: SessionSummary,
  type: SessionAction["type"],
  description: string,
  files?: string[]
): void {
  session.actions.push({
    timestamp: Date.now(),
    type,
    description,
    files,
  });

  session.stats.totalActions++;

  switch (type) {
    case "file_read":
      session.stats.filesRead++;
      break;
    case "file_edit":
      session.stats.filesEdited++;
      if (files) {
        for (const f of files) {
          if (!session.modifiedFiles.includes(f)) {
            session.modifiedFiles.push(f);
          }
        }
      }
      break;
    case "search":
      session.stats.searchesPerformed++;
      break;
    case "commit":
      session.stats.commitsCreated++;
      break;
  }
}

/**
 * Set work context description
 */
export function setWorkContext(session: SessionSummary, context: string): void {
  session.workContext = context;
}

/**
 * Refresh session with latest git info
 */
export function refreshSession(rootDir: string, session: SessionSummary): void {
  session.branch = getCurrentBranch(rootDir);
  session.commits = getRecentCommits(rootDir, 10);
  session.modifiedFiles = getChangedFiles(rootDir, {});
  session.lastUpdated = Date.now();
}

/**
 * Generate session summary for context
 */
export function generateSummary(rootDir: string): SessionSummary {
  let session = loadSession(rootDir);

  if (!session) {
    session = createSession(rootDir);
  } else {
    refreshSession(rootDir, session);
  }

  saveSession(rootDir, session);
  return session;
}

/**
 * Format session summary for Claude context
 */
export function formatSessionSummary(session: SessionSummary): string {
  const duration = Date.now() - session.startedAt;
  const durationMin = Math.round(duration / 60000);

  let output = `<session-summary id="${session.sessionId}">\n\n`;

  // Branch and duration
  output += `## Session Info\n`;
  output += `- Branch: ${session.branch}\n`;
  output += `- Duration: ${durationMin} minutes\n`;
  output += `- Started: ${new Date(session.startedAt).toISOString()}\n\n`;

  // Work context
  if (session.workContext) {
    output += `## Current Task\n${session.workContext}\n\n`;
  }

  // Recent commits
  if (session.commits.length > 0) {
    output += `## Recent Commits (${session.commits.length})\n`;
    for (const commit of session.commits.slice(0, 5)) {
      output += `- \`${commit.hash}\` ${commit.message}\n`;
    }
    output += "\n";
  }

  // Modified files
  if (session.modifiedFiles.length > 0) {
    output += `## Modified Files (${session.modifiedFiles.length})\n`;
    for (const file of session.modifiedFiles.slice(0, 10)) {
      output += `- ${file}\n`;
    }
    if (session.modifiedFiles.length > 10) {
      output += `- ... and ${session.modifiedFiles.length - 10} more\n`;
    }
    output += "\n";
  }

  // Recent actions
  if (session.actions.length > 0) {
    output += `## Recent Actions (${session.actions.length})\n`;
    const recentActions = session.actions.slice(-10);
    for (const action of recentActions) {
      const time = new Date(action.timestamp).toLocaleTimeString();
      output += `- [${time}] ${action.type}: ${action.description}\n`;
    }
    output += "\n";
  }

  // Stats
  output += `## Session Stats\n`;
  output += `- Files read: ${session.stats.filesRead}\n`;
  output += `- Files edited: ${session.stats.filesEdited}\n`;
  output += `- Searches: ${session.stats.searchesPerformed}\n`;
  output += `- Commits: ${session.stats.commitsCreated}\n`;

  output += `\n</session-summary>`;
  return output;
}

/**
 * Format compact session for quick resume
 */
export function formatCompactSummary(session: SessionSummary): string {
  let output = `Session: ${session.branch} | ${Math.round((Date.now() - session.startedAt) / 60000)}min\n`;

  if (session.workContext) {
    output += `Task: ${session.workContext.slice(0, 100)}\n`;
  }

  if (session.commits.length > 0) {
    output += `Last commit: ${session.commits[0].hash} - ${session.commits[0].message.slice(0, 50)}\n`;
  }

  if (session.modifiedFiles.length > 0) {
    output += `Modified: ${session.modifiedFiles.slice(0, 3).join(", ")}`;
    if (session.modifiedFiles.length > 3) {
      output += ` +${session.modifiedFiles.length - 3} more`;
    }
    output += "\n";
  }

  return output;
}

/**
 * Clear session
 */
export function clearSession(rootDir: string): void {
  const sessionPath = getSessionPath(rootDir);
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

/**
 * Check if session is stale (older than 4 hours)
 */
export function isSessionStale(session: SessionSummary, maxAge: number = 4 * 60 * 60 * 1000): boolean {
  return Date.now() - session.lastUpdated > maxAge;
}

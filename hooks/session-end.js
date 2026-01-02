#!/usr/bin/env node
/**
 * Stop hook - Save session state before ending
 * Captures: modified files, last commit, work context, budget stats
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const RAG_DIR = join(PROJECT_DIR, ".rag");
const TOOLKIT_PATH = join(PROJECT_DIR, "plugins/claude-code-toolkit/dist/search.js");
const SESSION_FILE = join(RAG_DIR, "session.json");
const BUDGET_FILE = join(RAG_DIR, "budget.json");
const HYPOTHESIS_FILE = join(RAG_DIR, "hypothesis.json");
const CONTEXT_LOCK_FILE = join(RAG_DIR, "context-state.json");

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", cwd: PROJECT_DIR, timeout: 10000 }).trim();
  } catch { return null; }
}

function getModifiedFiles() {
  const status = safeExec("git status --porcelain");
  if (!status) return [];
  return status.split("\n")
    .filter(l => l.trim())
    .map(l => l.slice(3).trim())
    .slice(0, 20);
}

function getLastCommit() {
  const log = safeExec("git log -1 --format=%H|%s|%at");
  if (!log) return null;
  const [hash, message, timestamp] = log.split("|");
  return { hash: hash.slice(0, 7), message, timestamp: parseInt(timestamp) * 1000 };
}

function getCurrentBranch() {
  return safeExec("git branch --show-current") || "unknown";
}

function getBudgetStats() {
  if (!existsSync(BUDGET_FILE)) return null;
  try {
    const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf-8"));
    return {
      consumed: budget.consumed || 0,
      total: budget.totalBudget || 50000,
      reads: budget.reads?.length || 0,
      alerts: budget.alerts?.length || 0
    };
  } catch { return null; }
}

function getHypothesisStats() {
  if (!existsSync(HYPOTHESIS_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(HYPOTHESIS_FILE, "utf-8"));
    return {
      task: data.task,
      total: data.hypotheses?.length || 0,
      validated: data.hypotheses?.filter(h => h.status === "validated")?.length || 0,
      rejected: data.hypotheses?.filter(h => h.status === "rejected")?.length || 0,
      pending: data.hypotheses?.filter(h => h.status === "pending")?.length || 0
    };
  } catch { return null; }
}

function cleanupSessionFiles() {
  // Reset context lock at end of session
  if (existsSync(CONTEXT_LOCK_FILE)) {
    try { unlinkSync(CONTEXT_LOCK_FILE); } catch {}
  }

  // Archive completed hypothesis sessions (no pending)
  const hypothesisStats = getHypothesisStats();
  if (hypothesisStats && hypothesisStats.pending === 0) {
    // All hypotheses resolved, can archive
    try {
      const archivePath = join(RAG_DIR, "hypothesis-archive.json");
      let archive = [];
      if (existsSync(archivePath)) {
        archive = JSON.parse(readFileSync(archivePath, "utf-8"));
      }
      const current = JSON.parse(readFileSync(HYPOTHESIS_FILE, "utf-8"));
      current.archivedAt = new Date().toISOString();
      archive.unshift(current);
      archive = archive.slice(0, 10); // Keep last 10
      writeFileSync(archivePath, JSON.stringify(archive, null, 2));
      unlinkSync(HYPOTHESIS_FILE);
    } catch {}
  }
}

try {
  // Load existing session or create new
  let session = { version: "1.0.0" };
  if (existsSync(SESSION_FILE)) {
    try {
      session = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
    } catch {}
  }

  // Update session with current state
  const now = Date.now();
  session.lastUpdated = now;
  session.endedAt = now;
  session.branch = getCurrentBranch();
  session.modifiedFiles = getModifiedFiles();

  const lastCommit = getLastCommit();
  if (lastCommit) {
    session.lastCommit = lastCommit;
    // Update commits array if exists
    if (session.commits && Array.isArray(session.commits)) {
      const exists = session.commits.find(c => c.hash === lastCommit.hash);
      if (!exists) {
        session.commits.unshift({
          hash: lastCommit.hash,
          message: lastCommit.message,
          timestamp: lastCommit.timestamp,
          filesChanged: 0
        });
        session.commits = session.commits.slice(0, 10);
      }
    }
  }

  // Calculate session duration if we have startedAt
  if (session.startedAt) {
    session.duration = Math.round((now - session.startedAt) / 60000); // minutes
  }

  // Add budget stats to session
  const budgetStats = getBudgetStats();
  if (budgetStats) {
    session.budgetStats = budgetStats;
  }

  // Add hypothesis stats to session
  const hypothesisStats = getHypothesisStats();
  if (hypothesisStats) {
    session.hypothesisStats = hypothesisStats;
  }

  // Save session
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

  // Cleanup temporary session files
  cleanupSessionFiles();

  // Output summary
  const duration = session.duration ? `${session.duration}min` : "unknown";
  const files = session.modifiedFiles?.length || 0;
  const commit = session.lastCommit?.message?.slice(0, 40) || "none";
  const budget = budgetStats ? `${Math.round(budgetStats.consumed/budgetStats.total*100)}% budget` : "";

  console.log(`📝 Session saved: ${duration} | ${files} files | ${budget} | Last: ${commit}`);

} catch (e) {
  // Silent fail - don't block session end
  console.log("Session save skipped");
}

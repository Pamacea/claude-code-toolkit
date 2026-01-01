#!/usr/bin/env node
/**
 * Stop hook - Save session state before ending
 * Captures: modified files, last commit, work context
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TOOLKIT_PATH = join(PROJECT_DIR, "plugins/claude-toolkit/dist/search.js");
const SESSION_FILE = join(PROJECT_DIR, ".rag-session.json");

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

  // Save session
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  
  // Output summary
  const duration = session.duration ? `${session.duration}min` : "unknown";
  const files = session.modifiedFiles?.length || 0;
  const commit = session.lastCommit?.message?.slice(0, 40) || "none";
  
  console.log(`📝 Session saved: ${duration} | ${files} files | Last: ${commit}`);
  
} catch (e) {
  // Silent fail - don't block session end
  console.log("Session save skipped");
}

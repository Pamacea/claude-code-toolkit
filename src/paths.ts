/**
 * Centralized path management for RAG toolkit
 * All generated files are stored in .rag/ directory
 */

import * as path from "path";
import * as fs from "fs";

// RAG directory name
export const RAG_DIR = ".rag";

// File names (without directory)
export const FILES = {
  INDEX: "index.json",
  CACHE: "cache.json",
  DEPS: "deps.json",
  HASHES: "hashes.json",
  BUDGET: "budget.json",
  HYPOTHESIS: "hypothesis.json",
  HYPOTHESIS_ARCHIVE: "hypothesis-archive.json",
  CONTEXT_STATE: "context-state.json",
  CONTRACTS: "contracts.json",
  IMPORTANCE: "importance.json",
  SESSION: "session.json",
  ERRORS: "errors.json",
  SNIPPETS: "snippets.json",
  MEMORY: "memory.json",
} as const;

/**
 * Get the .rag directory path for a project
 */
export function getRagDir(rootDir: string): string {
  return path.join(rootDir, RAG_DIR);
}

/**
 * Ensure .rag directory exists
 */
export function ensureRagDir(rootDir: string): string {
  const ragDir = getRagDir(rootDir);
  if (!fs.existsSync(ragDir)) {
    fs.mkdirSync(ragDir, { recursive: true });
  }
  return ragDir;
}

/**
 * Get full path to a RAG file
 */
export function getRagPath(rootDir: string, fileName: keyof typeof FILES): string {
  return path.join(getRagDir(rootDir), FILES[fileName]);
}

/**
 * Legacy file names for migration
 */
export const LEGACY_FILES: Record<keyof typeof FILES, string> = {
  INDEX: ".rag-index.json",
  CACHE: ".rag-cache.json",
  DEPS: ".rag-deps.json",
  HASHES: ".rag-hashes.json",
  BUDGET: ".rag-budget.json",
  HYPOTHESIS: ".rag-hypothesis.json",
  HYPOTHESIS_ARCHIVE: ".rag-hypothesis-archive.json",
  CONTEXT_STATE: ".rag-context-state.json",
  CONTRACTS: ".rag-contracts.json",
  IMPORTANCE: ".rag-importance.json",
  SESSION: ".rag-session.json",
  ERRORS: ".rag-errors.json",
  SNIPPETS: ".rag-snippets.json",
  MEMORY: ".claude-memory.json",
};

/**
 * Migrate legacy files from root to .rag/ directory
 */
export function migrateLegacyFiles(rootDir: string): { migrated: string[]; errors: string[] } {
  const migrated: string[] = [];
  const errors: string[] = [];

  ensureRagDir(rootDir);

  for (const [key, legacyName] of Object.entries(LEGACY_FILES)) {
    const legacyPath = path.join(rootDir, legacyName);
    const newPath = getRagPath(rootDir, key as keyof typeof FILES);

    if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
      try {
        fs.renameSync(legacyPath, newPath);
        migrated.push(legacyName);
      } catch (e) {
        errors.push(`${legacyName}: ${(e as Error).message}`);
      }
    }
  }

  return { migrated, errors };
}

/**
 * Check if legacy files exist (need migration)
 */
export function hasLegacyFiles(rootDir: string): boolean {
  for (const legacyName of Object.values(LEGACY_FILES)) {
    if (fs.existsSync(path.join(rootDir, legacyName))) {
      return true;
    }
  }
  return false;
}

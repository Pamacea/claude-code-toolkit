import * as fs from "fs";
import * as crypto from "crypto";
import { getRagPath, ensureRagDir } from "./paths.js";

export interface ErrorPattern {
  id: string;
  errorType: string;
  errorMessage: string;
  normalizedMessage: string;
  context: ErrorContext;
  solution: ErrorSolution;
  metadata: ErrorMetadata;
}

export interface ErrorContext {
  file?: string;
  line?: number;
  stackTrace?: string;
  command?: string;
  relatedFiles?: string[];
}

export interface ErrorSolution {
  description: string;
  steps: string[];
  codeChanges?: CodeChange[];
  commands?: string[];
  preventionTips?: string[];
}

export interface CodeChange {
  file: string;
  before: string;
  after: string;
}

export interface ErrorMetadata {
  createdAt: number;
  lastUsed: number;
  useCount: number;
  tags: string[];
  severity: "low" | "medium" | "high" | "critical";
}

export interface ErrorPatternDB {
  version: string;
  patterns: ErrorPattern[];
  stats: DBStats;
}

export interface DBStats {
  totalPatterns: number;
  totalLookups: number;
  successfulMatches: number;
  lastUpdated: number;
}

const DB_VERSION = "1.0.0";
const MAX_PATTERNS = 200;

/**
 * Get DB file path
 */
export function getDBPath(rootDir: string): string {
  return getRagPath(rootDir, "ERRORS");
}

/**
 * Normalize error message for matching
 */
export function normalizeError(message: string): string {
  return message
    .toLowerCase()
    .replace(/\d+/g, "N") // Replace numbers with N
    .replace(/['"`]/g, "") // Remove quotes
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/at line \d+/gi, "at line N")
    .replace(/:\d+:\d+/g, ":N:N") // Line:col
    .replace(/0x[a-f0-9]+/gi, "0xN") // Hex addresses
    .replace(/\/[\w\-./]+\.(ts|js|tsx|jsx)/g, "/FILE") // File paths
    .trim()
    .slice(0, 200);
}

/**
 * Generate error ID from normalized message
 */
export function generateErrorId(normalizedMessage: string, errorType: string): string {
  const hash = crypto.createHash("sha256")
    .update(`${errorType}:${normalizedMessage}`)
    .digest("hex")
    .slice(0, 12);
  return `err_${hash}`;
}

/**
 * Load error pattern DB
 */
export function loadErrorDB(rootDir: string): ErrorPatternDB {
  const dbPath = getDBPath(rootDir);

  if (!fs.existsSync(dbPath)) {
    return createEmptyDB();
  }

  try {
    const data = fs.readFileSync(dbPath, "utf-8");
    const db = JSON.parse(data) as ErrorPatternDB;

    if (db.version !== DB_VERSION) {
      return createEmptyDB();
    }

    return db;
  } catch {
    return createEmptyDB();
  }
}

/**
 * Save error pattern DB
 */
export function saveErrorDB(rootDir: string, db: ErrorPatternDB): void {
  ensureRagDir(rootDir);
  const dbPath = getDBPath(rootDir);
  db.stats.lastUpdated = Date.now();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

/**
 * Create empty DB
 */
function createEmptyDB(): ErrorPatternDB {
  return {
    version: DB_VERSION,
    patterns: [],
    stats: {
      totalPatterns: 0,
      totalLookups: 0,
      successfulMatches: 0,
      lastUpdated: Date.now(),
    },
  };
}

/**
 * Add a new error pattern
 */
export function addErrorPattern(
  db: ErrorPatternDB,
  errorType: string,
  errorMessage: string,
  solution: ErrorSolution,
  context?: ErrorContext,
  tags: string[] = [],
  severity: ErrorMetadata["severity"] = "medium"
): ErrorPattern {
  const normalizedMessage = normalizeError(errorMessage);
  const id = generateErrorId(normalizedMessage, errorType);

  // Check if exists
  const existingIndex = db.patterns.findIndex((p) => p.id === id);
  if (existingIndex !== -1) {
    // Update existing pattern
    const existing = db.patterns[existingIndex];
    existing.solution = solution;
    existing.metadata.lastUsed = Date.now();
    existing.metadata.useCount++;
    if (context) {
      existing.context = { ...existing.context, ...context };
    }
    for (const tag of tags) {
      if (!existing.metadata.tags.includes(tag)) {
        existing.metadata.tags.push(tag);
      }
    }
    return existing;
  }

  const pattern: ErrorPattern = {
    id,
    errorType,
    errorMessage: errorMessage.slice(0, 500),
    normalizedMessage,
    context: context || {},
    solution,
    metadata: {
      createdAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
      tags,
      severity,
    },
  };

  db.patterns.push(pattern);
  db.stats.totalPatterns++;

  // Enforce max size
  if (db.patterns.length > MAX_PATTERNS) {
    evictOldPatterns(db);
  }

  return pattern;
}

/**
 * Search for matching error pattern
 */
export function findErrorPattern(
  db: ErrorPatternDB,
  errorMessage: string,
  errorType?: string
): ErrorPattern | null {
  db.stats.totalLookups++;

  const normalized = normalizeError(errorMessage);

  // Exact match first
  let match = db.patterns.find((p) =>
    p.normalizedMessage === normalized &&
    (!errorType || p.errorType === errorType)
  );

  if (match) {
    match.metadata.lastUsed = Date.now();
    match.metadata.useCount++;
    db.stats.successfulMatches++;
    return match;
  }

  // Fuzzy match - look for similar patterns
  const candidates = db.patterns.filter((p) =>
    (!errorType || p.errorType === errorType) &&
    calculateSimilarity(normalized, p.normalizedMessage) > 0.7
  );

  if (candidates.length > 0) {
    // Return best match
    match = candidates.sort((a, b) =>
      calculateSimilarity(normalized, b.normalizedMessage) -
      calculateSimilarity(normalized, a.normalizedMessage)
    )[0];

    match.metadata.lastUsed = Date.now();
    match.metadata.useCount++;
    db.stats.successfulMatches++;
    return match;
  }

  return null;
}

/**
 * Calculate string similarity (Jaccard)
 */
function calculateSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size;
}

/**
 * Search patterns by tag
 */
export function searchByTag(db: ErrorPatternDB, tag: string): ErrorPattern[] {
  return db.patterns.filter((p) =>
    p.metadata.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))
  );
}

/**
 * Search patterns by keyword
 */
export function searchByKeyword(db: ErrorPatternDB, keyword: string): ErrorPattern[] {
  const kw = keyword.toLowerCase();
  return db.patterns.filter((p) =>
    p.errorMessage.toLowerCase().includes(kw) ||
    p.errorType.toLowerCase().includes(kw) ||
    p.solution.description.toLowerCase().includes(kw)
  );
}

/**
 * Get most common errors
 */
export function getMostCommon(db: ErrorPatternDB, count: number = 10): ErrorPattern[] {
  return [...db.patterns]
    .sort((a, b) => b.metadata.useCount - a.metadata.useCount)
    .slice(0, count);
}

/**
 * Get recent errors
 */
export function getRecentErrors(db: ErrorPatternDB, count: number = 10): ErrorPattern[] {
  return [...db.patterns]
    .sort((a, b) => b.metadata.createdAt - a.metadata.createdAt)
    .slice(0, count);
}

/**
 * Evict old/unused patterns
 */
function evictOldPatterns(db: ErrorPatternDB): void {
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  // Score = useCount * recency factor
  db.patterns.sort((a, b) => {
    const scoreA = a.metadata.useCount * Math.exp(-(now - a.metadata.lastUsed) / thirtyDays);
    const scoreB = b.metadata.useCount * Math.exp(-(now - b.metadata.lastUsed) / thirtyDays);
    return scoreB - scoreA;
  });

  db.patterns = db.patterns.slice(0, MAX_PATTERNS * 0.8);
  db.stats.totalPatterns = db.patterns.length;
}

/**
 * Delete a pattern by ID
 */
export function deletePattern(db: ErrorPatternDB, id: string): boolean {
  const index = db.patterns.findIndex((p) => p.id === id);
  if (index !== -1) {
    db.patterns.splice(index, 1);
    db.stats.totalPatterns--;
    return true;
  }
  return false;
}

/**
 * Format error pattern for display
 */
export function formatErrorPattern(pattern: ErrorPattern): string {
  let output = `## Error: ${pattern.errorType}\n\n`;
  output += `**Message:** ${pattern.errorMessage.slice(0, 200)}\n\n`;

  if (pattern.context.file) {
    output += `**File:** ${pattern.context.file}`;
    if (pattern.context.line) {
      output += `:${pattern.context.line}`;
    }
    output += "\n\n";
  }

  output += `### Solution\n${pattern.solution.description}\n\n`;

  if (pattern.solution.steps.length > 0) {
    output += `**Steps:**\n`;
    for (let i = 0; i < pattern.solution.steps.length; i++) {
      output += `${i + 1}. ${pattern.solution.steps[i]}\n`;
    }
    output += "\n";
  }

  if (pattern.solution.commands && pattern.solution.commands.length > 0) {
    output += `**Commands:**\n\`\`\`bash\n${pattern.solution.commands.join("\n")}\n\`\`\`\n\n`;
  }

  if (pattern.solution.codeChanges && pattern.solution.codeChanges.length > 0) {
    output += `**Code Changes:**\n`;
    for (const change of pattern.solution.codeChanges) {
      output += `\n*${change.file}*\n`;
      output += `\`\`\`diff\n- ${change.before}\n+ ${change.after}\n\`\`\`\n`;
    }
  }

  if (pattern.solution.preventionTips && pattern.solution.preventionTips.length > 0) {
    output += `\n**Prevention:**\n`;
    for (const tip of pattern.solution.preventionTips) {
      output += `- ${tip}\n`;
    }
  }

  output += `\n*Tags: ${pattern.metadata.tags.join(", ") || "none"} | Used: ${pattern.metadata.useCount}x | Severity: ${pattern.metadata.severity}*`;

  return output;
}

/**
 * Format error list for display
 */
export function formatErrorList(patterns: ErrorPattern[]): string {
  if (patterns.length === 0) {
    return "No error patterns found.";
  }

  let output = `# Error Patterns (${patterns.length})\n\n`;

  for (const pattern of patterns) {
    const truncatedMsg = pattern.errorMessage.slice(0, 60);
    output += `- **${pattern.errorType}**: ${truncatedMsg}${pattern.errorMessage.length > 60 ? "..." : ""}\n`;
    output += `  Solution: ${pattern.solution.description.slice(0, 80)}...\n`;
    output += `  *[${pattern.metadata.useCount}x | ${pattern.metadata.severity}]*\n\n`;
  }

  return output;
}

/**
 * Get DB statistics
 */
export function getDBStats(db: ErrorPatternDB): {
  totalPatterns: number;
  hitRate: number;
  avgUseCount: number;
  topTags: Array<{ tag: string; count: number }>;
} {
  const hitRate = db.stats.totalLookups > 0
    ? db.stats.successfulMatches / db.stats.totalLookups
    : 0;

  const avgUseCount = db.patterns.length > 0
    ? db.patterns.reduce((sum, p) => sum + p.metadata.useCount, 0) / db.patterns.length
    : 0;

  // Count tags
  const tagCounts: Record<string, number> = {};
  for (const pattern of db.patterns) {
    for (const tag of pattern.metadata.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalPatterns: db.stats.totalPatterns,
    hitRate,
    avgUseCount,
    topTags,
  };
}

/**
 * Quick add an error pattern with minimal info
 * Used for automatic learning from bash failures
 */
export function quickAddError(
  db: ErrorPatternDB,
  errorMessage: string,
  solution: string,
  options?: {
    errorType?: string;
    command?: string;
    file?: string;
    tags?: string[];
  }
): ErrorPattern | null {
  if (!errorMessage || !solution) return null;

  const errorType = options?.errorType || detectErrorType(errorMessage);
  const tags = options?.tags || detectTags(errorMessage);

  return addErrorPattern(
    db,
    errorType,
    errorMessage,
    {
      description: solution,
      steps: [],
      commands: options?.command ? [options.command] : [],
      preventionTips: [],
    },
    {
      command: options?.command,
      file: options?.file,
    },
    tags,
    "medium"
  );
}

/**
 * Detect error type from message
 */
function detectErrorType(message: string): string {
  const patterns: Array<{ regex: RegExp; type: string }> = [
    { regex: /TypeError/i, type: "TypeError" },
    { regex: /SyntaxError/i, type: "SyntaxError" },
    { regex: /ReferenceError/i, type: "ReferenceError" },
    { regex: /ENOENT/i, type: "FileNotFound" },
    { regex: /EACCES/i, type: "PermissionError" },
    { regex: /Module not found/i, type: "ModuleNotFound" },
    { regex: /Cannot find module/i, type: "ModuleNotFound" },
    { regex: /Cannot resolve/i, type: "ResolutionError" },
    { regex: /build failed/i, type: "BuildError" },
    { regex: /compilation failed/i, type: "BuildError" },
    { regex: /test failed/i, type: "TestError" },
    { regex: /assertion/i, type: "AssertionError" },
    { regex: /timeout/i, type: "TimeoutError" },
    { regex: /connection refused/i, type: "ConnectionError" },
  ];

  for (const { regex, type } of patterns) {
    if (regex.test(message)) {
      return type;
    }
  }

  return "Error";
}

/**
 * Detect tags from error message
 */
function detectTags(message: string): string[] {
  const tags: string[] = [];
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("typescript") || lowerMsg.includes(".ts")) tags.push("typescript");
  if (lowerMsg.includes("react") || lowerMsg.includes("jsx") || lowerMsg.includes("tsx")) tags.push("react");
  if (lowerMsg.includes("node") || lowerMsg.includes("npm") || lowerMsg.includes("pnpm")) tags.push("node");
  if (lowerMsg.includes("import") || lowerMsg.includes("export") || lowerMsg.includes("module")) tags.push("modules");
  if (lowerMsg.includes("test") || lowerMsg.includes("jest") || lowerMsg.includes("vitest")) tags.push("testing");
  if (lowerMsg.includes("build") || lowerMsg.includes("compile") || lowerMsg.includes("tsc")) tags.push("build");
  if (lowerMsg.includes("lint") || lowerMsg.includes("eslint")) tags.push("linting");
  if (lowerMsg.includes("type") && !lowerMsg.includes("typeerror")) tags.push("types");

  return tags;
}

/**
 * Read Optimizer - Advanced context optimization features
 *
 * 8 Features for reducing token consumption:
 * 1. Read Budget Manager - Token budget per session with justification
 * 2. Hypothesis-Driven Reading - Pre-read hypotheses validation
 * 3. Context Refusal Mode - Declare "sufficient context" to block reads
 * 4. Runtime Path Pruning - Stack trace analysis for relevant paths
 * 5. API Contract Snapshot - Signature comparison to avoid re-reads
 * 6. Error Locality Score - Composite scoring for file relevance
 * 7. Top-K Importance Index - Centrality-based file ranking
 * 8. Risk-Weighted Review - Security/perf weighted file filtering
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { loadGraph, getImporters, getDependencies, type DependencyGraph } from "./dependency-graph.js";
import { loadErrorDB, type ErrorPatternDB } from "./error-patterns.js";
import { getChangedFiles } from "./diff-context.js";
import { getRagPath, ensureRagDir } from "./paths.js";

// ============================================
// 1. READ BUDGET MANAGER
// ============================================

export interface ReadBudget {
  sessionId: string;
  startedAt: string;
  totalBudget: number;
  consumed: number;
  reads: ReadEntry[];
  justifications: Justification[];
  alerts: BudgetAlert[];
}

export interface ReadEntry {
  timestamp: string;
  filePath: string;
  lines: number;
  estimatedTokens: number;
  reason?: string;
  level: "metadata" | "signatures" | "types" | "chunks" | "full";
}

export interface Justification {
  timestamp: string;
  reason: string;
  additionalTokens: number;
  approved: boolean;
}

export interface BudgetAlert {
  timestamp: string;
  type: "warning" | "exceeded" | "blocked";
  message: string;
  consumed: number;
  budget: number;
}

const DEFAULT_BUDGET = 50000; // tokens
const CHARS_PER_TOKEN = 4;
const WARNING_THRESHOLD = 0.7; // 70%
const CRITICAL_THRESHOLD = 0.9; // 90%

export function createBudget(sessionId?: string): ReadBudget {
  return {
    sessionId: sessionId || crypto.randomUUID().slice(0, 8),
    startedAt: new Date().toISOString(),
    totalBudget: DEFAULT_BUDGET,
    consumed: 0,
    reads: [],
    justifications: [],
    alerts: [],
  };
}

export function loadBudget(rootDir: string): ReadBudget | null {
  const budgetPath = getRagPath(rootDir, "BUDGET");
  if (!fs.existsSync(budgetPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(budgetPath, "utf-8"));
    return data as ReadBudget;
  } catch {
    return null;
  }
}

export function saveBudget(rootDir: string, budget: ReadBudget): void {
  ensureRagDir(rootDir);
  const budgetPath = getRagPath(rootDir, "BUDGET");
  fs.writeFileSync(budgetPath, JSON.stringify(budget, null, 2));
}

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

export function estimateFileTokens(filePath: string, lines?: number): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n");
  const targetLines = lines ? allLines.slice(0, lines) : allLines;
  return estimateTokens(targetLines.join("\n"));
}

export function checkBudget(
  budget: ReadBudget,
  estimatedTokens: number
): { allowed: boolean; remaining: number; status: "ok" | "warning" | "critical" | "exceeded" } {
  const remaining = budget.totalBudget - budget.consumed;
  const ratio = budget.consumed / budget.totalBudget;

  if (budget.consumed + estimatedTokens > budget.totalBudget) {
    return { allowed: false, remaining, status: "exceeded" };
  }
  if (ratio >= CRITICAL_THRESHOLD) {
    return { allowed: true, remaining, status: "critical" };
  }
  if (ratio >= WARNING_THRESHOLD) {
    return { allowed: true, remaining, status: "warning" };
  }
  return { allowed: true, remaining, status: "ok" };
}

export function recordRead(
  budget: ReadBudget,
  filePath: string,
  lines: number,
  level: ReadEntry["level"],
  reason?: string
): { success: boolean; alert?: BudgetAlert } {
  const estimatedTokens = estimateFileTokens(filePath, lines);
  const check = checkBudget(budget, estimatedTokens);

  const entry: ReadEntry = {
    timestamp: new Date().toISOString(),
    filePath,
    lines,
    estimatedTokens,
    reason,
    level,
  };

  budget.reads.push(entry);
  budget.consumed += estimatedTokens;

  // Create alert if needed
  let alert: BudgetAlert | undefined;
  if (check.status !== "ok") {
    alert = {
      timestamp: new Date().toISOString(),
      type: check.status === "exceeded" ? "exceeded" : "warning",
      message: getBudgetAlertMessage(check.status, budget),
      consumed: budget.consumed,
      budget: budget.totalBudget,
    };
    budget.alerts.push(alert);
  }

  return { success: check.allowed, alert };
}

function getBudgetAlertMessage(status: string, budget: ReadBudget): string {
  const percent = Math.round((budget.consumed / budget.totalBudget) * 100);
  switch (status) {
    case "warning":
      return `⚠️ Budget at ${percent}% (${budget.consumed}/${budget.totalBudget} tokens)`;
    case "critical":
      return `🔴 Budget critical: ${percent}% (${budget.consumed}/${budget.totalBudget} tokens)`;
    case "exceeded":
      return `❌ Budget exceeded! ${percent}% - Justification required`;
    default:
      return "";
  }
}

export function requestBudgetIncrease(
  budget: ReadBudget,
  reason: string,
  additionalTokens: number
): Justification {
  const justification: Justification = {
    timestamp: new Date().toISOString(),
    reason,
    additionalTokens,
    approved: true, // Auto-approve with justification logged
  };
  budget.justifications.push(justification);
  budget.totalBudget += additionalTokens;
  return justification;
}

export function getBudgetStats(budget: ReadBudget): {
  consumed: number;
  remaining: number;
  budget: number;
  percentUsed: number;
  readCount: number;
  avgTokensPerRead: number;
  byLevel: Record<string, { count: number; tokens: number }>;
  topFiles: { path: string; tokens: number }[];
} {
  const byLevel: Record<string, { count: number; tokens: number }> = {};
  const byFile: Record<string, number> = {};

  for (const read of budget.reads) {
    if (!byLevel[read.level]) {
      byLevel[read.level] = { count: 0, tokens: 0 };
    }
    byLevel[read.level].count++;
    byLevel[read.level].tokens += read.estimatedTokens;

    byFile[read.filePath] = (byFile[read.filePath] || 0) + read.estimatedTokens;
  }

  const topFiles = Object.entries(byFile)
    .map(([path, tokens]) => ({ path, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  return {
    consumed: budget.consumed,
    remaining: budget.totalBudget - budget.consumed,
    budget: budget.totalBudget,
    percentUsed: Math.round((budget.consumed / budget.totalBudget) * 100),
    readCount: budget.reads.length,
    avgTokensPerRead: budget.reads.length ? Math.round(budget.consumed / budget.reads.length) : 0,
    byLevel,
    topFiles,
  };
}

export function formatBudgetReport(budget: ReadBudget): string {
  const stats = getBudgetStats(budget);
  const bar = createProgressBar(stats.percentUsed);

  let output = `\n📊 Read Budget Report\n\n`;
  output += `Session: ${budget.sessionId}\n`;
  output += `Started: ${new Date(budget.startedAt).toLocaleString()}\n\n`;
  output += `${bar} ${stats.percentUsed}%\n`;
  output += `Consumed: ${stats.consumed.toLocaleString()} / ${stats.budget.toLocaleString()} tokens\n`;
  output += `Remaining: ${stats.remaining.toLocaleString()} tokens\n\n`;
  output += `📖 Reads: ${stats.readCount} (avg ${stats.avgTokensPerRead} tokens/read)\n\n`;

  if (Object.keys(stats.byLevel).length > 0) {
    output += `By level:\n`;
    for (const [level, data] of Object.entries(stats.byLevel)) {
      output += `  ${level}: ${data.count} reads, ${data.tokens.toLocaleString()} tokens\n`;
    }
    output += "\n";
  }

  if (stats.topFiles.length > 0) {
    output += `Top files by tokens:\n`;
    for (const file of stats.topFiles.slice(0, 5)) {
      output += `  ${file.tokens.toLocaleString()} tokens - ${file.path}\n`;
    }
  }

  if (budget.justifications.length > 0) {
    output += `\n⚡ Budget increases: ${budget.justifications.length}\n`;
    for (const j of budget.justifications) {
      output += `  +${j.additionalTokens} tokens: ${j.reason}\n`;
    }
  }

  return output;
}

function createProgressBar(percent: number): string {
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const color = percent >= 90 ? "🔴" : percent >= 70 ? "🟡" : "🟢";
  return `${color} [${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

// ============================================
// 2. HYPOTHESIS-DRIVEN READING
// ============================================

export interface HypothesisSession {
  sessionId: string;
  task: string;
  createdAt: string;
  hypotheses: Hypothesis[];
  validatedFiles: string[];
  rejectedFiles: string[];
  readAttempts: ReadAttempt[];
}

export interface Hypothesis {
  id: string;
  description: string;
  targetFiles: string[];
  targetSymbols: string[];
  priority: number;
  status: "pending" | "validated" | "rejected";
  validatedAt?: string;
  evidence?: string;
}

export interface ReadAttempt {
  timestamp: string;
  filePath: string;
  hypothesisId: string | null;
  allowed: boolean;
  reason: string;
}

export function createHypothesisSession(task: string): HypothesisSession {
  return {
    sessionId: crypto.randomUUID().slice(0, 8),
    task,
    createdAt: new Date().toISOString(),
    hypotheses: [],
    validatedFiles: [],
    rejectedFiles: [],
    readAttempts: [],
  };
}

export function loadHypothesisSession(rootDir: string): HypothesisSession | null {
  const filePath = getRagPath(rootDir, "HYPOTHESIS");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as HypothesisSession;
  } catch {
    return null;
  }
}

export function saveHypothesisSession(rootDir: string, session: HypothesisSession): void {
  ensureRagDir(rootDir);
  const filePath = getRagPath(rootDir, "HYPOTHESIS");
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

export function addHypothesis(
  session: HypothesisSession,
  description: string,
  targetFiles: string[],
  targetSymbols: string[] = [],
  priority: number = 1
): Hypothesis {
  const hypothesis: Hypothesis = {
    id: crypto.randomUUID().slice(0, 8),
    description,
    targetFiles,
    targetSymbols,
    priority,
    status: "pending",
  };
  session.hypotheses.push(hypothesis);
  // Sort by priority
  session.hypotheses.sort((a, b) => b.priority - a.priority);
  return hypothesis;
}

export function validateHypothesis(
  session: HypothesisSession,
  hypothesisId: string,
  validated: boolean,
  evidence?: string
): void {
  const hypothesis = session.hypotheses.find((h) => h.id === hypothesisId);
  if (!hypothesis) return;

  hypothesis.status = validated ? "validated" : "rejected";
  hypothesis.validatedAt = new Date().toISOString();
  hypothesis.evidence = evidence;

  // Update file lists
  for (const file of hypothesis.targetFiles) {
    if (validated && !session.validatedFiles.includes(file)) {
      session.validatedFiles.push(file);
    }
    if (!validated && !session.rejectedFiles.includes(file)) {
      session.rejectedFiles.push(file);
    }
  }
}

export function isReadAllowedByHypothesis(
  session: HypothesisSession,
  filePath: string
): { allowed: boolean; hypothesisId: string | null; reason: string } {
  // Normalize path
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Check if in validated files
  if (session.validatedFiles.some((f) => normalizedPath.includes(f) || f.includes(normalizedPath))) {
    return { allowed: true, hypothesisId: null, reason: "File in validated list" };
  }

  // Check if in rejected files
  if (session.rejectedFiles.some((f) => normalizedPath.includes(f) || f.includes(normalizedPath))) {
    return { allowed: false, hypothesisId: null, reason: "File rejected by hypothesis" };
  }

  // Check if targeted by any pending hypothesis
  for (const h of session.hypotheses) {
    if (h.status === "pending") {
      for (const target of h.targetFiles) {
        if (normalizedPath.includes(target) || target.includes(normalizedPath)) {
          return { allowed: true, hypothesisId: h.id, reason: `Validates hypothesis: ${h.description}` };
        }
      }
    }
  }

  return { allowed: false, hypothesisId: null, reason: "File not in any hypothesis target" };
}

export function recordReadAttempt(
  session: HypothesisSession,
  filePath: string,
  result: { allowed: boolean; hypothesisId: string | null; reason: string }
): void {
  session.readAttempts.push({
    timestamp: new Date().toISOString(),
    filePath,
    hypothesisId: result.hypothesisId,
    allowed: result.allowed,
    reason: result.reason,
  });
}

export function getHypothesisStats(session: HypothesisSession): {
  total: number;
  pending: number;
  validated: number;
  rejected: number;
  allowedReads: number;
  blockedReads: number;
  hitRate: number;
} {
  const pending = session.hypotheses.filter((h) => h.status === "pending").length;
  const validated = session.hypotheses.filter((h) => h.status === "validated").length;
  const rejected = session.hypotheses.filter((h) => h.status === "rejected").length;
  const allowedReads = session.readAttempts.filter((r) => r.allowed).length;
  const blockedReads = session.readAttempts.filter((r) => !r.allowed).length;
  const total = allowedReads + blockedReads;

  return {
    total: session.hypotheses.length,
    pending,
    validated,
    rejected,
    allowedReads,
    blockedReads,
    hitRate: total > 0 ? Math.round((allowedReads / total) * 100) : 0,
  };
}

export function formatHypothesisReport(session: HypothesisSession): string {
  const stats = getHypothesisStats(session);

  let output = `\n🔬 Hypothesis-Driven Reading Report\n\n`;
  output += `Task: ${session.task}\n`;
  output += `Session: ${session.sessionId}\n\n`;

  output += `Hypotheses: ${stats.total} (${stats.pending} pending, ${stats.validated} validated, ${stats.rejected} rejected)\n`;
  output += `Read attempts: ${stats.allowedReads} allowed, ${stats.blockedReads} blocked\n`;
  output += `Hit rate: ${stats.hitRate}%\n\n`;

  if (session.hypotheses.length > 0) {
    output += `📋 Hypotheses:\n`;
    for (const h of session.hypotheses) {
      const icon = h.status === "validated" ? "✅" : h.status === "rejected" ? "❌" : "⏳";
      output += `  ${icon} [P${h.priority}] ${h.description}\n`;
      output += `     Targets: ${h.targetFiles.join(", ")}\n`;
      if (h.evidence) {
        output += `     Evidence: ${h.evidence}\n`;
      }
    }
  }

  return output;
}

// ============================================
// 3. CONTEXT REFUSAL MODE
// ============================================

export interface ContextState {
  sessionId: string;
  sufficientContext: boolean;
  declaredAt?: string;
  reason?: string;
  lockedFiles: string[];
  blockedAttempts: BlockedAttempt[];
  overrides: ContextOverride[];
}

export interface BlockedAttempt {
  timestamp: string;
  filePath: string;
  reason: string;
}

export interface ContextOverride {
  timestamp: string;
  filePath: string;
  reason: string;
}

export function createContextState(sessionId?: string): ContextState {
  return {
    sessionId: sessionId || crypto.randomUUID().slice(0, 8),
    sufficientContext: false,
    lockedFiles: [],
    blockedAttempts: [],
    overrides: [],
  };
}

export function loadContextState(rootDir: string): ContextState | null {
  const filePath = getRagPath(rootDir, "CONTEXT_STATE");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ContextState;
  } catch {
    return null;
  }
}

export function saveContextState(rootDir: string, state: ContextState): void {
  ensureRagDir(rootDir);
  const filePath = getRagPath(rootDir, "CONTEXT_STATE");
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function declareSufficientContext(
  state: ContextState,
  reason: string,
  currentFiles: string[] = []
): void {
  state.sufficientContext = true;
  state.declaredAt = new Date().toISOString();
  state.reason = reason;
  state.lockedFiles = [...new Set([...state.lockedFiles, ...currentFiles])];
}

export function unlockContext(state: ContextState): void {
  state.sufficientContext = false;
  state.declaredAt = undefined;
  state.reason = undefined;
}

export function attemptContextRead(
  state: ContextState,
  filePath: string
): { allowed: boolean; reason: string } {
  if (!state.sufficientContext) {
    return { allowed: true, reason: "Context not locked" };
  }

  // Check if file was already read before lock
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (state.lockedFiles.some((f) => normalizedPath.includes(f) || f.includes(normalizedPath))) {
    return { allowed: true, reason: "File was read before context lock" };
  }

  // Check for override
  if (state.overrides.some((o) => o.filePath === filePath)) {
    return { allowed: true, reason: "File has override" };
  }

  // Block the attempt
  state.blockedAttempts.push({
    timestamp: new Date().toISOString(),
    filePath,
    reason: "Context declared sufficient",
  });

  return { allowed: false, reason: `Context locked: ${state.reason}` };
}

export function addContextOverride(state: ContextState, filePath: string, reason: string): void {
  state.overrides.push({
    timestamp: new Date().toISOString(),
    filePath,
    reason,
  });
}

export function formatContextState(state: ContextState): string {
  let output = `\n🔒 Context State\n\n`;
  output += `Session: ${state.sessionId}\n`;
  output += `Status: ${state.sufficientContext ? "LOCKED 🔴" : "OPEN 🟢"}\n`;

  if (state.sufficientContext) {
    output += `Locked at: ${new Date(state.declaredAt!).toLocaleString()}\n`;
    output += `Reason: ${state.reason}\n`;
    output += `Locked files: ${state.lockedFiles.length}\n`;
  }

  output += `Blocked attempts: ${state.blockedAttempts.length}\n`;
  output += `Overrides: ${state.overrides.length}\n`;

  if (state.blockedAttempts.length > 0) {
    output += `\n⛔ Recent blocked:\n`;
    for (const b of state.blockedAttempts.slice(-5)) {
      output += `  ${b.filePath}\n`;
    }
  }

  return output;
}

// ============================================
// 4. RUNTIME PATH PRUNING
// ============================================

export interface RuntimePath {
  stackTrace: string;
  frames: StackFrame[];
  executedFiles: string[];
  executedFunctions: string[];
  prunedFiles: string[];
  callChain: string[];
}

export interface StackFrame {
  filePath: string;
  functionName: string;
  line: number;
  column?: number;
  isInternal: boolean;
}

// Parse JavaScript/TypeScript stack traces
export function parseStackTrace(stackTrace: string): StackFrame[] {
  const frames: StackFrame[] = [];
  const lines = stackTrace.split("\n");

  // Common stack trace patterns
  const patterns = [
    // Node.js / V8: "    at functionName (filePath:line:column)"
    /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/,
    // Node.js / V8: "    at filePath:line:column"
    /^\s*at\s+(.+?):(\d+):(\d+)$/,
    // Firefox: "functionName@filePath:line:column"
    /^(.+?)@(.+?):(\d+):(\d+)$/,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        let functionName: string;
        let filePath: string;
        let lineNum: number;
        let column: number | undefined;

        if (pattern === patterns[0]) {
          functionName = match[1] || "<anonymous>";
          filePath = match[2];
          lineNum = parseInt(match[3]);
          column = parseInt(match[4]);
        } else if (pattern === patterns[1]) {
          functionName = "<anonymous>";
          filePath = match[1];
          lineNum = parseInt(match[2]);
          column = parseInt(match[3]);
        } else {
          functionName = match[1];
          filePath = match[2];
          lineNum = parseInt(match[3]);
          column = parseInt(match[4]);
        }

        // Check if internal (node_modules, node internals)
        const isInternal =
          filePath.includes("node_modules") ||
          filePath.startsWith("node:") ||
          filePath.startsWith("internal/");

        frames.push({
          filePath: filePath.replace(/\\/g, "/"),
          functionName,
          line: lineNum,
          column,
          isInternal,
        });
        break;
      }
    }
  }

  return frames;
}

export function extractExecutionPath(frames: StackFrame[]): {
  files: string[];
  functions: string[];
} {
  const files = new Set<string>();
  const functions = new Set<string>();

  for (const frame of frames) {
    if (!frame.isInternal) {
      files.add(frame.filePath);
      if (frame.functionName !== "<anonymous>") {
        functions.add(`${frame.filePath}:${frame.functionName}`);
      }
    }
  }

  return {
    files: Array.from(files),
    functions: Array.from(functions),
  };
}

export function pruneIrrelevantFiles(
  allFiles: string[],
  executedFiles: string[],
  graph?: DependencyGraph
): { relevant: string[]; pruned: string[] } {
  const executedSet = new Set(executedFiles.map((f) => f.replace(/\\/g, "/")));
  const relevant = new Set<string>(executedSet);

  // If we have a graph, include direct dependencies and importers
  if (graph) {
    for (const file of executedFiles) {
      // Add dependencies
      const deps = getDependencies(graph, file, false);
      for (const dep of deps) {
        relevant.add(dep.replace(/\\/g, "/"));
      }
      // Add direct importers (1 level)
      const importers = getImporters(graph, file, false);
      for (const imp of importers.slice(0, 3)) {
        // Limit importers
        relevant.add(imp.replace(/\\/g, "/"));
      }
    }
  }

  const pruned: string[] = [];
  const relevantFiles: string[] = [];

  for (const file of allFiles) {
    const normalized = file.replace(/\\/g, "/");
    if (relevant.has(normalized) || Array.from(relevant).some((r) => normalized.includes(r))) {
      relevantFiles.push(file);
    } else {
      pruned.push(file);
    }
  }

  return { relevant: relevantFiles, pruned };
}

export function analyzeRuntimePath(
  stackTrace: string,
  allFiles: string[],
  rootDir: string
): RuntimePath {
  const frames = parseStackTrace(stackTrace);
  const { files, functions } = extractExecutionPath(frames);

  // Try to load graph for better pruning
  const graph = loadGraph(rootDir);
  const { pruned } = pruneIrrelevantFiles(allFiles, files, graph || undefined);

  // Build call chain from frames
  const callChain = frames
    .filter((f) => !f.isInternal)
    .map((f) => `${f.functionName} (${path.basename(f.filePath)}:${f.line})`)
    .reverse();

  return {
    stackTrace,
    frames,
    executedFiles: files,
    executedFunctions: functions,
    prunedFiles: pruned,
    callChain,
  };
}

export function formatRuntimePath(runtimePath: RuntimePath): string {
  let output = `\n🔍 Runtime Path Analysis\n\n`;
  output += `Executed files: ${runtimePath.executedFiles.length}\n`;
  output += `Pruned files: ${runtimePath.prunedFiles.length}\n`;
  output += `Savings: ${Math.round((runtimePath.prunedFiles.length / (runtimePath.executedFiles.length + runtimePath.prunedFiles.length)) * 100)}%\n\n`;

  if (runtimePath.callChain.length > 0) {
    output += `📞 Call chain:\n`;
    for (let i = 0; i < runtimePath.callChain.length; i++) {
      const indent = "  ".repeat(i);
      output += `${indent}→ ${runtimePath.callChain[i]}\n`;
    }
    output += "\n";
  }

  output += `✅ Relevant files:\n`;
  for (const f of runtimePath.executedFiles.slice(0, 10)) {
    output += `  ${f}\n`;
  }

  if (runtimePath.prunedFiles.length > 0) {
    output += `\n❌ Pruned (not in execution path):\n`;
    for (const f of runtimePath.prunedFiles.slice(0, 5)) {
      output += `  ${f}\n`;
    }
    if (runtimePath.prunedFiles.length > 5) {
      output += `  ... and ${runtimePath.prunedFiles.length - 5} more\n`;
    }
  }

  return output;
}

// ============================================
// 5. API CONTRACT SNAPSHOT
// ============================================

export interface ContractSnapshot {
  version: string;
  createdAt: string;
  files: Record<string, FileContract>;
}

export interface FileContract {
  filePath: string;
  hash: string;
  signatures: SignatureInfo[];
  lastChecked: string;
}

export interface SignatureInfo {
  name: string;
  type: "function" | "class" | "interface" | "type" | "const" | "method";
  signature: string;
  exported: boolean;
  line: number;
}

export interface ContractDiff {
  added: SignatureInfo[];
  removed: SignatureInfo[];
  modified: { old: SignatureInfo; new: SignatureInfo }[];
  unchanged: number;
}

const CONTRACT_VERSION = "1.0.0";

export function createContractSnapshot(): ContractSnapshot {
  return {
    version: CONTRACT_VERSION,
    createdAt: new Date().toISOString(),
    files: {},
  };
}

export function loadContractSnapshot(rootDir: string): ContractSnapshot | null {
  const filePath = getRagPath(rootDir, "CONTRACTS");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ContractSnapshot;
  } catch {
    return null;
  }
}

export function saveContractSnapshot(rootDir: string, snapshot: ContractSnapshot): void {
  ensureRagDir(rootDir);
  const filePath = getRagPath(rootDir, "CONTRACTS");
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

// Extract signatures from a TypeScript/JavaScript file
export function extractSignatures(filePath: string): SignatureInfo[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const signatures: SignatureInfo[] = [];

  // Patterns for extracting signatures
  const patterns = {
    // export function name(...): type
    exportFunction: /^export\s+(?:async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/,
    // export const name = ...
    exportConst: /^export\s+const\s+(\w+)\s*(?::\s*([^=]+))?\s*=/,
    // export class Name
    exportClass: /^export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/,
    // export interface Name
    exportInterface: /^export\s+interface\s+(\w+)(?:<[^>]+>)?/,
    // export type Name
    exportType: /^export\s+type\s+(\w+)(?:<[^>]+>)?\s*=/,
    // function name (non-exported)
    function: /^(?:async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/,
    // class method
    method: /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Export function
    let match = line.match(patterns.exportFunction);
    if (match) {
      signatures.push({
        name: match[1],
        type: "function",
        signature: `function ${match[1]}${match[2] || ""}(${match[3]})${match[4] ? `: ${match[4].trim()}` : ""}`,
        exported: true,
        line: i + 1,
      });
      continue;
    }

    // Export const
    match = line.match(patterns.exportConst);
    if (match) {
      signatures.push({
        name: match[1],
        type: "const",
        signature: `const ${match[1]}${match[2] ? `: ${match[2].trim()}` : ""}`,
        exported: true,
        line: i + 1,
      });
      continue;
    }

    // Export class
    match = line.match(patterns.exportClass);
    if (match) {
      signatures.push({
        name: match[1],
        type: "class",
        signature: line.replace(/\s*\{.*$/, ""),
        exported: true,
        line: i + 1,
      });
      continue;
    }

    // Export interface
    match = line.match(patterns.exportInterface);
    if (match) {
      signatures.push({
        name: match[1],
        type: "interface",
        signature: line.replace(/\s*\{.*$/, ""),
        exported: true,
        line: i + 1,
      });
      continue;
    }

    // Export type
    match = line.match(patterns.exportType);
    if (match) {
      signatures.push({
        name: match[1],
        type: "type",
        signature: line,
        exported: true,
        line: i + 1,
      });
      continue;
    }
  }

  return signatures;
}

export function captureFileContract(filePath: string): FileContract {
  const signatures = extractSignatures(filePath);
  const hash = crypto
    .createHash("md5")
    .update(signatures.map((s) => s.signature).join("\n"))
    .digest("hex");

  return {
    filePath: filePath.replace(/\\/g, "/"),
    hash,
    signatures,
    lastChecked: new Date().toISOString(),
  };
}

export function compareContracts(
  oldContract: FileContract | undefined,
  newContract: FileContract
): ContractDiff {
  if (!oldContract) {
    return {
      added: newContract.signatures,
      removed: [],
      modified: [],
      unchanged: 0,
    };
  }

  const oldMap = new Map(oldContract.signatures.map((s) => [s.name, s]));
  const newMap = new Map(newContract.signatures.map((s) => [s.name, s]));

  const added: SignatureInfo[] = [];
  const removed: SignatureInfo[] = [];
  const modified: { old: SignatureInfo; new: SignatureInfo }[] = [];
  let unchanged = 0;

  // Find added and modified
  for (const [name, newSig] of newMap) {
    const oldSig = oldMap.get(name);
    if (!oldSig) {
      added.push(newSig);
    } else if (oldSig.signature !== newSig.signature) {
      modified.push({ old: oldSig, new: newSig });
    } else {
      unchanged++;
    }
  }

  // Find removed
  for (const [name, oldSig] of oldMap) {
    if (!newMap.has(name)) {
      removed.push(oldSig);
    }
  }

  return { added, removed, modified, unchanged };
}

export function hasContractChanged(snapshot: ContractSnapshot, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const oldContract = snapshot.files[normalized];
  if (!oldContract) return true;

  const newContract = captureFileContract(filePath);
  return oldContract.hash !== newContract.hash;
}

export function updateContractSnapshot(
  snapshot: ContractSnapshot,
  filePath: string
): { contract: FileContract; diff: ContractDiff } {
  const normalized = filePath.replace(/\\/g, "/");
  const oldContract = snapshot.files[normalized];
  const newContract = captureFileContract(filePath);
  const diff = compareContracts(oldContract, newContract);

  snapshot.files[normalized] = newContract;

  return { contract: newContract, diff };
}

export function getAffectedByContractChange(
  snapshot: ContractSnapshot,
  graph: DependencyGraph,
  changedFile: string
): string[] {
  const normalized = changedFile.replace(/\\/g, "/");
  const contract = snapshot.files[normalized];
  if (!contract) return [];

  // Get all importers of this file
  const importers = getImporters(graph, changedFile, true);

  // Filter to only those that use changed exports
  // For now, return all importers (more sophisticated filtering would need AST analysis)
  return importers;
}

export function formatContractDiff(diff: ContractDiff, filePath: string): string {
  let output = `\n📜 Contract Diff: ${path.basename(filePath)}\n\n`;

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
    output += `✅ No changes (${diff.unchanged} signatures unchanged)\n`;
    return output;
  }

  if (diff.added.length > 0) {
    output += `➕ Added (${diff.added.length}):\n`;
    for (const s of diff.added) {
      output += `  + ${s.signature}\n`;
    }
  }

  if (diff.removed.length > 0) {
    output += `➖ Removed (${diff.removed.length}):\n`;
    for (const s of diff.removed) {
      output += `  - ${s.signature}\n`;
    }
  }

  if (diff.modified.length > 0) {
    output += `✏️ Modified (${diff.modified.length}):\n`;
    for (const m of diff.modified) {
      output += `  ~ ${m.old.name}:\n`;
      output += `    - ${m.old.signature}\n`;
      output += `    + ${m.new.signature}\n`;
    }
  }

  output += `\nUnchanged: ${diff.unchanged}\n`;

  return output;
}

// ============================================
// 6. ERROR LOCALITY SCORE
// ============================================

export interface LocalityScore {
  filePath: string;
  score: number;
  factors: ScoreFactors;
  rank?: number;
}

export interface ScoreFactors {
  recency: number;
  diffProximity: number;
  errorHistory: number;
  centrality: number;
}

export interface LocalityOptions {
  errorMessage?: string;
  changedFiles?: string[];
  graph?: DependencyGraph;
  errorDB?: ErrorPatternDB;
}

// Calculate recency score (0-25) based on mtime
function getRecencyScore(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const stats = fs.statSync(filePath);
  const ageMs = Date.now() - stats.mtimeMs;
  const ageHours = ageMs / (1000 * 60 * 60);

  // Recently modified = higher score
  if (ageHours < 1) return 25;
  if (ageHours < 4) return 20;
  if (ageHours < 24) return 15;
  if (ageHours < 72) return 10;
  if (ageHours < 168) return 5; // 1 week
  return 0;
}

// Calculate diff proximity score (0-25)
function getDiffProximityScore(filePath: string, changedFiles: string[]): number {
  const normalized = filePath.replace(/\\/g, "/");
  // Exact match
  if (changedFiles.some((f) => f.replace(/\\/g, "/") === normalized)) {
    return 25;
  }
  // Same directory
  const dir = path.dirname(normalized);
  if (changedFiles.some((f) => path.dirname(f.replace(/\\/g, "/")) === dir)) {
    return 15;
  }
  // Same parent directory
  const parentDir = path.dirname(dir);
  if (changedFiles.some((f) => path.dirname(path.dirname(f.replace(/\\/g, "/"))) === parentDir)) {
    return 5;
  }
  return 0;
}

// Calculate error history score (0-25)
function getErrorHistoryScore(filePath: string, errorDB: ErrorPatternDB): number {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = path.basename(normalized);

  // Count errors mentioning this file
  let errorCount = 0;
  for (const pattern of errorDB.patterns) {
    if (
      pattern.errorMessage.includes(basename) ||
      pattern.solution.description.includes(basename) ||
      pattern.metadata.tags.includes(basename)
    ) {
      errorCount++;
    }
  }

  if (errorCount >= 5) return 25;
  if (errorCount >= 3) return 20;
  if (errorCount >= 2) return 15;
  if (errorCount >= 1) return 10;
  return 0;
}

// Calculate centrality score (0-25)
function getCentralityScore(filePath: string, graph: DependencyGraph): number {
  const normalized = filePath.replace(/\\/g, "/");
  const node = graph.nodes.get(normalized);
  if (!node) return 0;

  // Centrality = importers + dependencies
  const importers = node.importedBy.length;
  const imports = node.imports.length;
  const total = importers + imports;

  if (total >= 20) return 25;
  if (total >= 10) return 20;
  if (total >= 5) return 15;
  if (total >= 2) return 10;
  if (total >= 1) return 5;
  return 0;
}

export function calculateLocalityScore(filePath: string, options: LocalityOptions = {}): LocalityScore {
  const factors: ScoreFactors = {
    recency: getRecencyScore(filePath),
    diffProximity: options.changedFiles ? getDiffProximityScore(filePath, options.changedFiles) : 0,
    errorHistory: options.errorDB ? getErrorHistoryScore(filePath, options.errorDB) : 0,
    centrality: options.graph ? getCentralityScore(filePath, options.graph) : 0,
  };

  const score = factors.recency + factors.diffProximity + factors.errorHistory + factors.centrality;

  return {
    filePath,
    score,
    factors,
  };
}

export function rankFilesByLocality(files: string[], options: LocalityOptions = {}): LocalityScore[] {
  const scores = files.map((f) => calculateLocalityScore(f, options));
  scores.sort((a, b) => b.score - a.score);

  // Add ranks
  for (let i = 0; i < scores.length; i++) {
    scores[i].rank = i + 1;
  }

  return scores;
}

export function filterByLocalityThreshold(scores: LocalityScore[], minScore: number = 25): LocalityScore[] {
  return scores.filter((s) => s.score >= minScore);
}

export function formatLocalityReport(scores: LocalityScore[]): string {
  let output = `\n🎯 Error Locality Scores\n\n`;
  output += `Files analyzed: ${scores.length}\n`;

  const aboveThreshold = scores.filter((s) => s.score >= 25).length;
  output += `Above threshold (25+): ${aboveThreshold}\n\n`;

  output += `Top files:\n`;
  for (const s of scores.slice(0, 10)) {
    const bar = "█".repeat(Math.floor(s.score / 10)) + "░".repeat(10 - Math.floor(s.score / 10));
    output += `  [${bar}] ${s.score}/100 ${path.basename(s.filePath)}\n`;
    output += `    R:${s.factors.recency} D:${s.factors.diffProximity} E:${s.factors.errorHistory} C:${s.factors.centrality}\n`;
  }

  return output;
}

// ============================================
// 7. TOP-K IMPORTANCE INDEX
// ============================================

export interface ImportanceIndex {
  version: string;
  createdAt: string;
  topK: number;
  files: ImportanceEntry[];
}

export interface ImportanceEntry {
  filePath: string;
  importance: number;
  factors: ImportanceFactors;
}

export interface ImportanceFactors {
  centrality: number;
  churn: number;
  size: number;
  exports: number;
  isEntry: number;
}

const DEFAULT_TOP_K = 30;

export function createImportanceIndex(topK: number = DEFAULT_TOP_K): ImportanceIndex {
  return {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    topK,
    files: [],
  };
}

export function loadImportanceIndex(rootDir: string): ImportanceIndex | null {
  const filePath = getRagPath(rootDir, "IMPORTANCE");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ImportanceIndex;
  } catch {
    return null;
  }
}

export function saveImportanceIndex(rootDir: string, index: ImportanceIndex): void {
  ensureRagDir(rootDir);
  const filePath = getRagPath(rootDir, "IMPORTANCE");
  fs.writeFileSync(filePath, JSON.stringify(index, null, 2));
}

// Get git commit count for a file (churn)
function getGitChurn(filePath: string, rootDir: string): number {
  try {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
    const result = execSync(`git log --oneline -- "${relativePath}"`, {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

// Get file size score (smaller files often more important - core logic)
function getSizeScore(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").length;

  // Smaller files score higher (core logic tends to be concise)
  // But very small files (< 10 lines) might be trivial
  if (lines < 10) return 5;
  if (lines < 50) return 20;
  if (lines < 100) return 15;
  if (lines < 200) return 10;
  if (lines < 500) return 5;
  return 0;
}

export function calculateImportance(
  filePath: string,
  graph: DependencyGraph,
  rootDir: string
): ImportanceEntry {
  const normalized = filePath.replace(/\\/g, "/");
  const node = graph.nodes.get(normalized);

  const factors: ImportanceFactors = {
    centrality: 0,
    churn: 0,
    size: getSizeScore(filePath),
    exports: 0,
    isEntry: 0,
  };

  if (node) {
    // Centrality: importers count more than imports
    factors.centrality = Math.min(30, node.importedBy.length * 3 + node.imports.length);
    factors.exports = Math.min(20, node.exports.length * 4);
    factors.isEntry = node.isEntryPoint ? 15 : 0;
  }

  // Git churn
  const churn = getGitChurn(filePath, rootDir);
  factors.churn = Math.min(15, Math.floor(churn / 5) * 3);

  const importance =
    factors.centrality + factors.churn + factors.size + factors.exports + factors.isEntry;

  return {
    filePath: normalized,
    importance,
    factors,
  };
}

export function buildImportanceIndex(rootDir: string, topK: number = DEFAULT_TOP_K): ImportanceIndex {
  const graph = loadGraph(rootDir);
  if (!graph) {
    return createImportanceIndex(topK);
  }

  const entries: ImportanceEntry[] = [];
  for (const [filePath] of graph.nodes) {
    const fullPath = path.join(rootDir, filePath);
    if (fs.existsSync(fullPath)) {
      entries.push(calculateImportance(fullPath, graph, rootDir));
    }
  }

  // Sort by importance
  entries.sort((a, b) => b.importance - a.importance);

  return {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    topK,
    files: entries,
  };
}

export function getTopKFiles(index: ImportanceIndex, k?: number): ImportanceEntry[] {
  const limit = k || index.topK;
  return index.files.slice(0, limit);
}

export function isInTopK(index: ImportanceIndex, filePath: string, k?: number): boolean {
  const limit = k || index.topK;
  const normalized = filePath.replace(/\\/g, "/");
  const topFiles = index.files.slice(0, limit);
  return topFiles.some((e) => e.filePath === normalized || normalized.includes(e.filePath));
}

export function formatImportanceReport(index: ImportanceIndex): string {
  let output = `\n⭐ File Importance Index\n\n`;
  output += `Total files: ${index.files.length}\n`;
  output += `Top-K: ${index.topK}\n`;
  output += `Created: ${new Date(index.createdAt).toLocaleString()}\n\n`;

  output += `Top ${Math.min(15, index.topK)} files:\n`;
  for (let i = 0; i < Math.min(15, index.files.length); i++) {
    const e = index.files[i];
    const bar = "█".repeat(Math.floor(e.importance / 10)) + "░".repeat(10 - Math.floor(e.importance / 10));
    output += `  ${String(i + 1).padStart(2)}. [${bar}] ${e.importance} ${path.basename(e.filePath)}\n`;
    output += `      C:${e.factors.centrality} G:${e.factors.churn} S:${e.factors.size} E:${e.factors.exports}${e.factors.isEntry ? " 📍" : ""}\n`;
  }

  return output;
}

// ============================================
// 8. RISK-WEIGHTED REVIEW
// ============================================

export interface RiskAssessment {
  filePath: string;
  riskLevel: "critical" | "high" | "medium" | "low" | "minimal";
  riskScore: number;
  factors: RiskFactors;
  matches: RiskMatch[];
}

export interface RiskFactors {
  security: number;
  performance: number;
  complexity: number;
  external: number;
  dataHandling: number;
}

export interface RiskMatch {
  category: keyof RiskFactors;
  pattern: string;
  line: number;
  context: string;
}

// Risk detection patterns
const RISK_PATTERNS: Record<keyof RiskFactors, { pattern: RegExp; weight: number }[]> = {
  security: [
    { pattern: /password|passwd|secret|token|apikey|api_key/i, weight: 25 },
    { pattern: /auth|authenticate|authorize|credential/i, weight: 20 },
    { pattern: /crypto|encrypt|decrypt|hash|bcrypt|jwt/i, weight: 20 },
    { pattern: /\beval\s*\(|\bexec\s*\(|Function\s*\(/i, weight: 25 },
    { pattern: /innerHTML|outerHTML|document\.write/i, weight: 15 },
    { pattern: /sql|query.*\$|query.*\+/i, weight: 20 },
    { pattern: /sanitize|escape|validate|xss|csrf/i, weight: 10 },
  ],
  performance: [
    { pattern: /\.query\(|\.execute\(|\.findAll\(|\.find\(/i, weight: 15 },
    { pattern: /for\s*\(.*\.length|while\s*\(/i, weight: 10 },
    { pattern: /async.*await.*for|Promise\.all/i, weight: 10 },
    { pattern: /setTimeout|setInterval|requestAnimationFrame/i, weight: 5 },
    { pattern: /cache|memoize|useMemo|useCallback/i, weight: 5 },
    { pattern: /lazy|defer|prefetch|preload/i, weight: 5 },
  ],
  complexity: [
    { pattern: /if.*if.*if|else.*else.*else/i, weight: 10 },
    { pattern: /switch\s*\([^)]+\)\s*\{(?:[^}]*case[^}]*){5,}/i, weight: 15 },
    { pattern: /\?\s*.*\?\s*.*\?/i, weight: 10 }, // Nested ternaries
    { pattern: /try\s*\{[^}]+try\s*\{/i, weight: 10 }, // Nested try
  ],
  external: [
    { pattern: /fetch\s*\(|axios|http\.|https\./i, weight: 15 },
    { pattern: /\.get\(|\.post\(|\.put\(|\.delete\(/i, weight: 10 },
    { pattern: /webhook|callback|endpoint/i, weight: 10 },
    { pattern: /socket|websocket|ws\./i, weight: 15 },
    { pattern: /graphql|grpc|rest/i, weight: 10 },
  ],
  dataHandling: [
    { pattern: /email|phone|address|ssn|social.?security/i, weight: 20 },
    { pattern: /credit.?card|card.?number|cvv|expir/i, weight: 25 },
    { pattern: /personal|private|sensitive|pii/i, weight: 15 },
    { pattern: /gdpr|hipaa|pci|compliance/i, weight: 10 },
    { pattern: /user\..*\.|profile\.|account\./i, weight: 10 },
  ],
};

export function assessFileRisk(filePath: string): RiskAssessment {
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      riskLevel: "minimal",
      riskScore: 0,
      factors: { security: 0, performance: 0, complexity: 0, external: 0, dataHandling: 0 },
      matches: [],
    };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const factors: RiskFactors = { security: 0, performance: 0, complexity: 0, external: 0, dataHandling: 0 };
  const matches: RiskMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const [category, patterns] of Object.entries(RISK_PATTERNS) as [
      keyof RiskFactors,
      { pattern: RegExp; weight: number }[],
    ][]) {
      for (const { pattern, weight } of patterns) {
        if (pattern.test(line)) {
          factors[category] = Math.min(25, factors[category] + weight);
          matches.push({
            category,
            pattern: pattern.source,
            line: i + 1,
            context: line.trim().slice(0, 60),
          });
        }
      }
    }
  }

  const riskScore = Object.values(factors).reduce((a, b) => a + b, 0);

  let riskLevel: RiskAssessment["riskLevel"];
  if (riskScore >= 80) riskLevel = "critical";
  else if (riskScore >= 60) riskLevel = "high";
  else if (riskScore >= 40) riskLevel = "medium";
  else if (riskScore >= 20) riskLevel = "low";
  else riskLevel = "minimal";

  return {
    filePath,
    riskLevel,
    riskScore,
    factors,
    matches,
  };
}

export function assessDiffRisk(rootDir: string): RiskAssessment[] {
  const changedFiles = getChangedFiles(rootDir);
  return changedFiles.map((f) => assessFileRisk(path.join(rootDir, f)));
}

export function filterByRisk(
  files: string[],
  minRisk: RiskAssessment["riskLevel"] = "low"
): { included: RiskAssessment[]; excluded: RiskAssessment[] } {
  const riskOrder = ["minimal", "low", "medium", "high", "critical"];
  const minIndex = riskOrder.indexOf(minRisk);

  const assessments = files.map((f) => assessFileRisk(f));
  const included = assessments.filter((a) => riskOrder.indexOf(a.riskLevel) >= minIndex);
  const excluded = assessments.filter((a) => riskOrder.indexOf(a.riskLevel) < minIndex);

  return { included, excluded };
}

export function formatRiskReport(assessments: RiskAssessment[]): string {
  let output = `\n🛡️ Risk Assessment Report\n\n`;

  const byLevel = {
    critical: assessments.filter((a) => a.riskLevel === "critical"),
    high: assessments.filter((a) => a.riskLevel === "high"),
    medium: assessments.filter((a) => a.riskLevel === "medium"),
    low: assessments.filter((a) => a.riskLevel === "low"),
    minimal: assessments.filter((a) => a.riskLevel === "minimal"),
  };

  output += `Files analyzed: ${assessments.length}\n`;
  output += `🔴 Critical: ${byLevel.critical.length}\n`;
  output += `🟠 High: ${byLevel.high.length}\n`;
  output += `🟡 Medium: ${byLevel.medium.length}\n`;
  output += `🟢 Low: ${byLevel.low.length}\n`;
  output += `⚪ Minimal: ${byLevel.minimal.length}\n\n`;

  // Show critical and high risk files
  const important = [...byLevel.critical, ...byLevel.high].sort((a, b) => b.riskScore - a.riskScore);

  if (important.length > 0) {
    output += `⚠️ Files requiring review:\n`;
    for (const a of important.slice(0, 10)) {
      const icon = a.riskLevel === "critical" ? "🔴" : "🟠";
      output += `  ${icon} ${path.basename(a.filePath)} (score: ${a.riskScore})\n`;
      output += `     S:${a.factors.security} P:${a.factors.performance} C:${a.factors.complexity} E:${a.factors.external} D:${a.factors.dataHandling}\n`;
    }
  }

  return output;
}

// ============================================
// UNIFIED OPTIMIZER
// ============================================

export interface OptimizerConfig {
  budgetEnabled: boolean;
  hypothesisEnabled: boolean;
  contextRefusalEnabled: boolean;
  runtimePruningEnabled: boolean;
  contractsEnabled: boolean;
  localityEnabled: boolean;
  importanceEnabled: boolean;
  riskEnabled: boolean;
  topK: number;
  budgetLimit: number;
  minRiskLevel: RiskAssessment["riskLevel"];
  localityThreshold: number;
}

export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  budgetEnabled: true,
  hypothesisEnabled: false, // Requires explicit activation
  contextRefusalEnabled: true,
  runtimePruningEnabled: true,
  contractsEnabled: true,
  localityEnabled: true,
  importanceEnabled: true,
  riskEnabled: true,
  topK: 30,
  budgetLimit: 50000,
  minRiskLevel: "low",
  localityThreshold: 25,
};

export interface ReadDecision {
  allowed: boolean;
  reason: string;
  score?: number;
  suggestions?: string[];
  budgetImpact?: number;
}

export function shouldAllowRead(
  filePath: string,
  rootDir: string,
  config: OptimizerConfig = DEFAULT_OPTIMIZER_CONFIG
): ReadDecision {
  const suggestions: string[] = [];
  let totalScore = 100; // Start with full score, deduct for violations

  // 1. Check budget
  if (config.budgetEnabled) {
    const budget = loadBudget(rootDir);
    if (budget) {
      const estimated = estimateFileTokens(filePath);
      const check = checkBudget(budget, estimated);
      if (!check.allowed) {
        return {
          allowed: false,
          reason: "Budget exceeded - justification required",
          budgetImpact: estimated,
          suggestions: ["Use --signatures-only or --types-only to reduce tokens", "Request budget increase with justification"],
        };
      }
      if (check.status === "critical") {
        totalScore -= 20;
        suggestions.push("Budget critical - consider minimal read modes");
      }
    }
  }

  // 2. Check context state
  if (config.contextRefusalEnabled) {
    const contextState = loadContextState(rootDir);
    if (contextState?.sufficientContext) {
      const result = attemptContextRead(contextState, filePath);
      if (!result.allowed) {
        return {
          allowed: false,
          reason: result.reason,
          suggestions: ["Context declared sufficient", "Add override if this file is critical"],
        };
      }
    }
  }

  // 3. Check hypothesis session
  if (config.hypothesisEnabled) {
    const hypothesisSession = loadHypothesisSession(rootDir);
    if (hypothesisSession && hypothesisSession.hypotheses.length > 0) {
      const result = isReadAllowedByHypothesis(hypothesisSession, filePath);
      if (!result.allowed) {
        return {
          allowed: false,
          reason: result.reason,
          suggestions: ["Add this file to a hypothesis target", "Validate/reject pending hypotheses first"],
        };
      }
    }
  }

  // 4. Check importance index
  if (config.importanceEnabled) {
    const importanceIndex = loadImportanceIndex(rootDir);
    if (importanceIndex && !isInTopK(importanceIndex, filePath, config.topK)) {
      totalScore -= 30;
      suggestions.push(`File not in top-${config.topK} importance - consider if really needed`);
    }
  }

  // 5. Check risk level
  if (config.riskEnabled) {
    const riskAssessment = assessFileRisk(filePath);
    const riskOrder = ["minimal", "low", "medium", "high", "critical"];
    if (riskOrder.indexOf(riskAssessment.riskLevel) < riskOrder.indexOf(config.minRiskLevel)) {
      totalScore -= 20;
      suggestions.push(`Low risk file (${riskAssessment.riskLevel}) - may not need detailed review`);
    }
  }

  // 6. Check locality score
  if (config.localityEnabled) {
    const graph = loadGraph(rootDir);
    const changedFiles = getChangedFiles(rootDir);
    const errorDB = loadErrorDB(rootDir);

    const localityScore = calculateLocalityScore(filePath, {
      changedFiles,
      graph: graph || undefined,
      errorDB: errorDB || undefined,
    });

    if (localityScore.score < config.localityThreshold) {
      totalScore -= 15;
      suggestions.push(`Low locality score (${localityScore.score}) - file may not be relevant to current task`);
    }
  }

  return {
    allowed: true,
    reason: totalScore >= 50 ? "Read allowed" : "Read allowed with warnings",
    score: totalScore,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    budgetImpact: estimateFileTokens(filePath),
  };
}

export function formatOptimizerStatus(rootDir: string): string {
  let output = `\n🔧 Read Optimizer Status\n\n`;

  // Budget
  const budget = loadBudget(rootDir);
  if (budget) {
    const stats = getBudgetStats(budget);
    output += `📊 Budget: ${stats.consumed}/${stats.budget} tokens (${stats.percentUsed}%)\n`;
  } else {
    output += `📊 Budget: Not initialized\n`;
  }

  // Context state
  const contextState = loadContextState(rootDir);
  output += `🔒 Context: ${contextState?.sufficientContext ? "LOCKED" : "Open"}\n`;

  // Hypothesis
  const hypothesis = loadHypothesisSession(rootDir);
  if (hypothesis) {
    const stats = getHypothesisStats(hypothesis);
    output += `🔬 Hypotheses: ${stats.total} (${stats.validated} validated)\n`;
  } else {
    output += `🔬 Hypotheses: None active\n`;
  }

  // Contracts
  const contracts = loadContractSnapshot(rootDir);
  output += `📜 Contracts: ${contracts ? Object.keys(contracts.files).length : 0} files tracked\n`;

  // Importance
  const importance = loadImportanceIndex(rootDir);
  output += `⭐ Importance: ${importance ? importance.files.length : 0} files indexed\n`;

  return output;
}

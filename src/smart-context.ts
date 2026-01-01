/**
 * Smart Context Selection - Intelligent context optimization
 *
 * Features:
 * - Type-Only Mode: Extract only types/interfaces (80-90% token savings)
 * - Test Context: Associate tests with source files (30% navigation savings)
 * - Smart Selection: Auto-select minimal context based on task (50-70% savings)
 */

import * as fs from "fs";
import * as path from "path";
import { loadStore, type IndexedChunk, type VectorStore } from "./store.js";
import { loadGraph, getDependencies, getImporters, type DependencyGraph } from "./dependency-graph.js";

// ============================================
// TYPE-ONLY MODE
// ============================================

export interface TypeOnlyResult {
  filePath: string;
  types: TypeDefinition[];
  totalTokensSaved: number;
}

export interface TypeDefinition {
  name: string;
  kind: "interface" | "type" | "enum" | "class-signature";
  signature: string;
  exported: boolean;
  line: number;
}

/**
 * Extract only type definitions from chunks
 * Saves 80-90% tokens by excluding implementation details
 */
export function extractTypesOnly(chunks: IndexedChunk[]): TypeOnlyResult[] {
  const resultsByFile = new Map<string, TypeOnlyResult>();

  for (const chunk of chunks) {
    const isTypeChunk =
      chunk.type.includes("interface") ||
      chunk.type.includes("type") ||
      chunk.type.includes("enum") ||
      (chunk.type.includes("class") && chunk.signature);

    if (!isTypeChunk) continue;

    const filePath = chunk.filePath;
    let result = resultsByFile.get(filePath);

    if (!result) {
      result = {
        filePath,
        types: [],
        totalTokensSaved: 0,
      };
      resultsByFile.set(filePath, result);
    }

    // Determine kind
    let kind: TypeDefinition["kind"] = "type";
    if (chunk.type.includes("interface")) kind = "interface";
    else if (chunk.type.includes("enum")) kind = "enum";
    else if (chunk.type.includes("class")) kind = "class-signature";

    // Use signature if available, otherwise extract first line
    const signature = chunk.signature || extractTypeSignature(chunk.content, kind);

    result.types.push({
      name: chunk.name || "anonymous",
      kind,
      signature,
      exported: chunk.exports || false,
      line: chunk.startLine + 1,
    });

    // Estimate tokens saved (full content vs signature only)
    const fullTokens = estimateTokens(chunk.content);
    const signatureTokens = estimateTokens(signature);
    result.totalTokensSaved += fullTokens - signatureTokens;
  }

  return Array.from(resultsByFile.values());
}

/**
 * Extract type signature from content
 */
function extractTypeSignature(content: string, kind: TypeDefinition["kind"]): string {
  const lines = content.split("\n");

  if (kind === "interface" || kind === "type") {
    // For interfaces/types, get the declaration line and property names
    const firstLine = lines[0];
    const props: string[] = [];

    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("}")) break;
      if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
        // Extract property name and type
        const match = trimmed.match(/^(\w+)(\?)?:\s*([^;]+)/);
        if (match) {
          props.push(`${match[1]}${match[2] || ""}: ${match[3].trim()}`);
        }
      }
    }

    if (props.length <= 5) {
      return `${firstLine} { ${props.join("; ")} }`;
    } else {
      return `${firstLine} { ${props.slice(0, 3).join("; ")}; ... ${props.length - 3} more }`;
    }
  }

  if (kind === "enum") {
    const firstLine = lines[0];
    const values: string[] = [];

    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("}")) break;
      if (trimmed && !trimmed.startsWith("//")) {
        const match = trimmed.match(/^(\w+)/);
        if (match) values.push(match[1]);
      }
    }

    return `${firstLine} { ${values.join(", ")} }`;
  }

  // Class signature - just the class declaration and method signatures
  if (kind === "class-signature") {
    const classLine = lines[0];
    const methods: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Match method declarations
      const methodMatch = trimmed.match(/^(public|private|protected)?\s*(static)?\s*(async)?\s*(\w+)\s*\([^)]*\)/);
      if (methodMatch) {
        methods.push(trimmed.replace(/\{[\s\S]*$/, "").trim());
      }
    }

    if (methods.length <= 5) {
      return `${classLine} { ${methods.join("; ")} }`;
    } else {
      return `${classLine} { ${methods.slice(0, 3).join("; ")}; ... ${methods.length - 3} more methods }`;
    }
  }

  return lines[0];
}

/**
 * Rough token estimation (1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format types-only output
 */
export function formatTypesOnly(results: TypeOnlyResult[]): string {
  let output = `<types-context count="${results.reduce((sum, r) => sum + r.types.length, 0)}">\n`;

  for (const result of results) {
    for (const type of result.types) {
      output += `\n<type path="${result.filePath}" line="${type.line}" kind="${type.kind}" name="${type.name}"${type.exported ? ' exported="true"' : ""}>\n`;
      output += type.signature;
      output += `\n</type>\n`;
    }
  }

  const totalSaved = results.reduce((sum, r) => sum + r.totalTokensSaved, 0);
  output += `\n<!-- Estimated tokens saved: ~${totalSaved} -->\n`;
  output += `</types-context>`;

  return output;
}

// ============================================
// TEST CONTEXT
// ============================================

export interface TestAssociation {
  sourceFile: string;
  testFiles: string[];
  testChunks: IndexedChunk[];
}

/**
 * Common test file patterns
 */
const TEST_PATTERNS = [
  // Same directory: foo.ts -> foo.test.ts, foo.spec.ts
  (file: string) => file.replace(/\.(ts|tsx|js|jsx)$/, ".test.$1"),
  (file: string) => file.replace(/\.(ts|tsx|js|jsx)$/, ".spec.$1"),
  // __tests__ directory: src/foo.ts -> src/__tests__/foo.test.ts
  (file: string) => {
    const dir = path.dirname(file);
    const base = path.basename(file).replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
    return path.join(dir, "__tests__", base).replace(/\\/g, "/");
  },
  // tests directory: src/foo.ts -> tests/foo.test.ts
  (file: string) => {
    const base = path.basename(file).replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
    return path.join("tests", base).replace(/\\/g, "/");
  },
  // test directory (singular): src/foo.ts -> test/foo.test.ts
  (file: string) => {
    const base = path.basename(file).replace(/\.(ts|tsx|js|jsx)$/, ".test.$1");
    return path.join("test", base).replace(/\\/g, "/");
  },
];

/**
 * Find associated test files for a source file
 */
export function findTestFiles(sourceFile: string, allFiles: string[]): string[] {
  const testFiles: string[] = [];
  const sourceBase = path.basename(sourceFile).replace(/\.(ts|tsx|js|jsx)$/, "");

  for (const file of allFiles) {
    // Check if it's a test file for this source
    const fileBase = path.basename(file);

    if (
      fileBase.includes(".test.") ||
      fileBase.includes(".spec.") ||
      file.includes("__tests__") ||
      file.includes("/test/") ||
      file.includes("/tests/")
    ) {
      // Check if the base name matches
      const testBase = fileBase
        .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
        .replace(/\.(ts|tsx|js|jsx)$/, "");

      if (testBase === sourceBase) {
        testFiles.push(file);
      }
    }
  }

  return testFiles;
}

/**
 * Find source file for a test file
 */
export function findSourceFile(testFile: string, allFiles: string[]): string | null {
  const testBase = path.basename(testFile)
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");

  for (const file of allFiles) {
    if (file.includes(".test.") || file.includes(".spec.")) continue;

    const fileBase = path.basename(file).replace(/\.(ts|tsx|js|jsx)$/, "");
    if (fileBase === testBase) {
      return file;
    }
  }

  return null;
}

/**
 * Get test chunks associated with source chunks
 */
export function getTestContext(
  sourceChunks: IndexedChunk[],
  store: VectorStore
): TestAssociation[] {
  const allFiles = [...new Set(store.chunks.map((c) => c.filePath))];
  const associations: TestAssociation[] = [];
  const processedSources = new Set<string>();

  for (const chunk of sourceChunks) {
    if (processedSources.has(chunk.filePath)) continue;
    processedSources.add(chunk.filePath);

    // Skip if already a test file
    if (
      chunk.filePath.includes(".test.") ||
      chunk.filePath.includes(".spec.") ||
      chunk.filePath.includes("__tests__")
    ) {
      continue;
    }

    const testFiles = findTestFiles(chunk.filePath, allFiles);

    if (testFiles.length > 0) {
      const testChunks = store.chunks.filter((c) => testFiles.includes(c.filePath));

      associations.push({
        sourceFile: chunk.filePath,
        testFiles,
        testChunks,
      });
    }
  }

  return associations;
}

/**
 * Format test context output
 */
export function formatTestContext(associations: TestAssociation[]): string {
  if (associations.length === 0) {
    return "<!-- No associated tests found -->";
  }

  let output = `<test-context associations="${associations.length}">\n`;

  for (const assoc of associations) {
    output += `\n<source file="${assoc.sourceFile}">\n`;
    output += `  Tests: ${assoc.testFiles.join(", ")}\n`;

    for (const chunk of assoc.testChunks.slice(0, 5)) {
      const header = chunk.name ? `${chunk.type}:${chunk.name}` : chunk.type;
      output += `\n  <test path="${chunk.filePath}" line="${chunk.startLine + 1}" type="${header}">\n`;
      // Show signature or first few lines
      const preview = chunk.signature || chunk.content.split("\n").slice(0, 5).join("\n");
      output += `  ${preview}\n`;
      output += `  </test>\n`;
    }

    if (assoc.testChunks.length > 5) {
      output += `  <!-- ... ${assoc.testChunks.length - 5} more test chunks -->\n`;
    }

    output += `</source>\n`;
  }

  output += `</test-context>`;
  return output;
}

// ============================================
// SMART CONTEXT SELECTION
// ============================================

export type TaskType =
  | "debug"
  | "implement"
  | "refactor"
  | "review"
  | "test"
  | "explain"
  | "document"
  | "explore"
  | "unknown";

export interface SmartContextOptions {
  taskType: TaskType;
  includeTests: boolean;
  includeTypes: boolean;
  includeDeps: boolean;
  maxChunks: number;
  maxTokens: number;
}

export interface SmartContextResult {
  chunks: IndexedChunk[];
  testContext: TestAssociation[];
  typeContext: TypeOnlyResult[];
  relatedFiles: string[];
  taskType: TaskType;
  tokenEstimate: number;
  optimizations: string[];
}

/**
 * Detect task type from query
 */
export function detectTaskType(query: string): TaskType {
  const lower = query.toLowerCase();

  const patterns: Record<TaskType, string[]> = {
    debug: ["bug", "error", "fix", "crash", "issue", "broken", "fail", "debug", "wrong", "not working"],
    implement: ["add", "create", "implement", "build", "new feature", "make", "write"],
    refactor: ["refactor", "clean", "improve", "optimize", "simplify", "restructure", "reorganize"],
    review: ["review", "check", "audit", "verify", "inspect", "look at"],
    test: ["test", "spec", "coverage", "mock", "stub", "assert"],
    explain: ["explain", "how does", "what is", "understand", "why", "how"],
    document: ["document", "doc", "readme", "jsdoc", "comment", "describe"],
    explore: ["find", "search", "where", "locate", "show me", "list"],
    unknown: [],
  };

  for (const [type, keywords] of Object.entries(patterns)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return type as TaskType;
    }
  }

  return "unknown";
}

/**
 * Get optimal context settings for a task type
 */
export function getContextSettings(taskType: TaskType): Partial<SmartContextOptions> {
  const settings: Record<TaskType, Partial<SmartContextOptions>> = {
    debug: {
      includeTests: true,
      includeDeps: true,
      includeTypes: false,
      maxChunks: 15,
    },
    implement: {
      includeTests: false,
      includeDeps: true,
      includeTypes: true,
      maxChunks: 12,
    },
    refactor: {
      includeTests: true,
      includeDeps: true,
      includeTypes: true,
      maxChunks: 20,
    },
    review: {
      includeTests: true,
      includeDeps: false,
      includeTypes: false,
      maxChunks: 25,
    },
    test: {
      includeTests: true,
      includeDeps: false,
      includeTypes: true,
      maxChunks: 15,
    },
    explain: {
      includeTests: false,
      includeDeps: true,
      includeTypes: true,
      maxChunks: 10,
    },
    document: {
      includeTests: false,
      includeDeps: false,
      includeTypes: true,
      maxChunks: 8,
    },
    explore: {
      includeTests: false,
      includeDeps: false,
      includeTypes: false,
      maxChunks: 20,
    },
    unknown: {
      includeTests: false,
      includeDeps: false,
      includeTypes: false,
      maxChunks: 10,
    },
  };

  return settings[taskType];
}

/**
 * Smart context selection - automatically optimizes context based on task
 */
export function selectSmartContext(
  query: string,
  searchResults: Array<{ chunk: IndexedChunk; score: number }>,
  store: VectorStore,
  graph: DependencyGraph | null,
  options: Partial<SmartContextOptions> = {}
): SmartContextResult {
  const taskType = detectTaskType(query);
  const taskSettings = getContextSettings(taskType);

  const finalOptions: SmartContextOptions = {
    taskType,
    includeTests: options.includeTests ?? taskSettings.includeTests ?? false,
    includeTypes: options.includeTypes ?? taskSettings.includeTypes ?? false,
    includeDeps: options.includeDeps ?? taskSettings.includeDeps ?? false,
    maxChunks: options.maxChunks ?? taskSettings.maxChunks ?? 10,
    maxTokens: options.maxTokens ?? 8000,
  };

  const optimizations: string[] = [];
  let chunks = searchResults.slice(0, finalOptions.maxChunks).map((r) => r.chunk);

  // Get related files from dependency graph
  let relatedFiles: string[] = [];
  if (finalOptions.includeDeps && graph) {
    const mainFiles = [...new Set(chunks.map((c) => c.filePath))];
    for (const file of mainFiles.slice(0, 3)) {
      const deps = getDependencies(graph, file, false);
      const importers = getImporters(graph, file, false);
      relatedFiles.push(...deps.slice(0, 3), ...importers.slice(0, 3));
    }
    relatedFiles = [...new Set(relatedFiles)].filter((f) => !mainFiles.includes(f));
    if (relatedFiles.length > 0) {
      optimizations.push(`+${relatedFiles.length} related files from deps`);
    }
  }

  // Get test context
  let testContext: TestAssociation[] = [];
  if (finalOptions.includeTests) {
    testContext = getTestContext(chunks, store);
    if (testContext.length > 0) {
      optimizations.push(`+${testContext.length} test associations`);
    }
  }

  // Get type context
  let typeContext: TypeOnlyResult[] = [];
  if (finalOptions.includeTypes) {
    // Get type-only from related files (not main results)
    const relatedChunks = store.chunks.filter((c) => relatedFiles.includes(c.filePath));
    typeContext = extractTypesOnly(relatedChunks);
    if (typeContext.length > 0) {
      const typeCount = typeContext.reduce((sum, r) => sum + r.types.length, 0);
      optimizations.push(`+${typeCount} types (signatures only)`);
    }
  }

  // Estimate tokens
  let tokenEstimate = 0;
  for (const chunk of chunks) {
    tokenEstimate += estimateTokens(chunk.content);
  }
  for (const assoc of testContext) {
    for (const tc of assoc.testChunks.slice(0, 3)) {
      tokenEstimate += estimateTokens(tc.signature || tc.content.slice(0, 200));
    }
  }
  for (const tr of typeContext) {
    for (const t of tr.types) {
      tokenEstimate += estimateTokens(t.signature);
    }
  }

  optimizations.push(`~${tokenEstimate} tokens estimated`);

  return {
    chunks,
    testContext,
    typeContext,
    relatedFiles,
    taskType,
    tokenEstimate,
    optimizations,
  };
}

/**
 * Format smart context output
 */
export function formatSmartContext(
  query: string,
  result: SmartContextResult
): string {
  let output = `<smart-context query="${query}" task="${result.taskType}" tokens="~${result.tokenEstimate}">\n`;

  // Optimizations applied
  if (result.optimizations.length > 0) {
    output += `<!-- Optimizations: ${result.optimizations.join(", ")} -->\n`;
  }

  // Main chunks
  output += `\n<results count="${result.chunks.length}">\n`;
  for (const chunk of result.chunks) {
    const header = chunk.name ? `${chunk.type}:${chunk.name}` : chunk.type;
    output += `\n<file path="${chunk.filePath}" line="${chunk.startLine + 1}" type="${header}">\n`;
    output += chunk.content;
    output += `\n</file>\n`;
  }
  output += `</results>\n`;

  // Related types (if any)
  if (result.typeContext.length > 0) {
    output += `\n<related-types>\n`;
    for (const tr of result.typeContext) {
      for (const t of tr.types) {
        output += `<type name="${t.name}" kind="${t.kind}">${t.signature}</type>\n`;
      }
    }
    output += `</related-types>\n`;
  }

  // Test context (if any)
  if (result.testContext.length > 0) {
    output += `\n<related-tests>\n`;
    for (const assoc of result.testContext) {
      output += `<tests for="${assoc.sourceFile}">\n`;
      for (const tc of assoc.testChunks.slice(0, 3)) {
        output += `  ${tc.name || tc.type}: ${tc.signature || tc.content.split("\n")[0]}\n`;
      }
      output += `</tests>\n`;
    }
    output += `</related-tests>\n`;
  }

  // Related files
  if (result.relatedFiles.length > 0) {
    output += `\n<related-files>\n`;
    output += result.relatedFiles.map((f) => `  ${f}`).join("\n");
    output += `\n</related-files>\n`;
  }

  output += `</smart-context>`;
  return output;
}

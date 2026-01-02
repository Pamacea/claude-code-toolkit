#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { initEmbedder, embed } from "./embedder.js";
import { loadStore, search, formatSearchResults, type IndexedChunk } from "./store.js";
import {
  loadCache,
  saveCache,
  lookupExact,
  lookupSimilar,
  addToCache,
  recordHit,
  recordMiss,
  cleanExpired,
  getCacheStats,
  formatCachedResults,
  type CachedResult,
} from "./cache.js";
import {
  getDiffContext,
  formatDiffContext,
  getChangedFiles,
  getDiffStats,
  getCurrentBranch,
} from "./diff-context.js";
import {
  loadMemory,
  saveMemory,
  generateMemory,
  formatMemoryContext,
  needsRefresh,
} from "./memory.js";
import {
  getTemplate,
  getTemplatesByCategory,
  listTemplates,
  searchTemplates,
  suggestTemplates,
  formatTemplate,
  formatTemplateList,
  type PromptTemplate,
} from "./prompt-templates.js";
import {
  buildGraph,
  loadGraph,
  saveGraph,
  findExport,
  findDeadExports,
  formatGraphStats,
  formatFileDependencies,
  formatImpactAnalysis,
} from "./dependency-graph.js";
import {
  incrementalReindex,
  checkForChanges,
  getRecentlyModified,
  formatWatcherStats,
} from "./file-watcher.js";
import {
  extractTypesOnly,
  formatTypesOnly,
  getTestContext,
  formatTestContext,
  selectSmartContext,
  formatSmartContext,
} from "./smart-context.js";
import {
  generateCommitMessage,
  formatCommitSuggestion,
  getCommitCommand,
  executeCommit,
  hasStagedChanges,
  hasUnstagedChanges,
} from "./auto-commit.js";
import {
  loadSession,
  saveSession,
  createSession,
  generateSummary,
  formatSessionSummary,
  formatCompactSummary,
  clearSession,
  setWorkContext,
} from "./session-summary.js";
import {
  loadErrorDB,
  saveErrorDB,
  addErrorPattern,
  findErrorPattern,
  searchByKeyword,
  searchByTag,
  getMostCommon,
  getRecentErrors,
  deletePattern,
  formatErrorPattern,
  formatErrorList,
  getDBStats as getErrorDBStats,
} from "./error-patterns.js";
import {
  loadSnippetsCache,
  saveSnippetsCache,
  addSnippet,
  findSnippet,
  searchSnippets,
  getByCategory,
  getMostUsed as getMostUsedSnippets,
  getRecentSnippets,
  deleteSnippet,
  formatSnippet,
  formatSnippetList,
  getCacheStats as getSnippetStats,
  recordUsage,
} from "./snippets-cache.js";
import {
  // Budget Manager
  createBudget,
  loadBudget,
  saveBudget,
  recordRead,
  estimateTokens,
  requestBudgetIncrease,
  formatBudgetReport,
  // Hypothesis-Driven Reading
  createHypothesisSession,
  loadHypothesisSession,
  saveHypothesisSession,
  addHypothesis,
  validateHypothesis,
  isReadAllowedByHypothesis,
  formatHypothesisReport,
  // Context Refusal Mode
  createContextState,
  loadContextState,
  saveContextState,
  declareSufficientContext,
  unlockContext,
  attemptContextRead,
  addContextOverride,
  formatContextState,
  // Runtime Path Pruning
  analyzeRuntimePath,
  formatRuntimePath,
  // API Contract Snapshot
  loadContractSnapshot,
  saveContractSnapshot,
  createContractSnapshot,
  updateContractSnapshot,
  hasContractChanged,
  formatContractDiff,
  // Error Locality Score
  calculateLocalityScore,
  rankFilesByLocality,
  formatLocalityReport,
  // Top-K Importance Index
  loadImportanceIndex,
  saveImportanceIndex,
  buildImportanceIndex,
  isInTopK,
  formatImportanceReport,
  // Risk-Weighted Review
  assessFileRisk,
  assessDiffRisk,
  formatRiskReport,
  // Unified Optimizer
  shouldAllowRead,
  formatOptimizerStatus,
} from "./read-optimizer.js";

program
  .name("rag-search")
  .description("Search the indexed codebase")
  .version("1.0.0");

program
  .command("query <question>")
  .description("Search for relevant code")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-k, --top-k <number>", "Number of results", "5")
  .option("-s, --min-score <number>", "Minimum similarity score", "0.3")
  .option("--json", "Output as JSON")
  .action(async (question, options) => {
    const rootDir = path.resolve(options.dir);
    const store = loadStore(rootDir);

    if (!store) {
      console.error(chalk.red("No index found. Run 'rag-index index' first."));
      process.exit(1);
    }

    await initEmbedder();

    const queryEmbedding = await embed(question);
    const results = search(
      store,
      queryEmbedding,
      parseInt(options.topK),
      parseFloat(options.minScore)
    );

    if (options.json) {
      console.log(
        JSON.stringify(
          results.map((r) => ({
            file: r.chunk.filePath,
            line: r.chunk.startLine + 1,
            type: r.chunk.type,
            name: r.chunk.name,
            score: r.score,
            content: r.chunk.content,
          })),
          null,
          2
        )
      );
    } else {
      console.log(formatSearchResults(results));
    }
  });

program
  .command("interactive")
  .alias("i")
  .description("Interactive search mode")
  .option("-d, --dir <path>", "Root directory", ".")
  .action(async (options) => {
    const rootDir = path.resolve(options.dir);
    const store = loadStore(rootDir);

    if (!store) {
      console.error(chalk.red("No index found. Run 'rag-index index' first."));
      process.exit(1);
    }

    console.log(chalk.blue("\n🔍 RAG Search - Interactive Mode"));
    console.log(chalk.gray("Type your query and press Enter. Type 'exit' to quit.\n"));

    await initEmbedder();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (): void => {
      rl.question(chalk.yellow("Query: "), async (query) => {
        if (query.toLowerCase() === "exit") {
          rl.close();
          return;
        }

        if (!query.trim()) {
          askQuestion();
          return;
        }

        const queryEmbedding = await embed(query);
        const results = search(store, queryEmbedding, 5, 0.3);

        console.log("\n" + formatSearchResults(results));
        askQuestion();
      });
    };

    askQuestion();
  });

program
  .command("context <question>")
  .description("Get context for Claude Code (compact format)")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-k, --top-k <number>", "Number of results", "8")
  .option("--with-deps", "Include dependency information")
  .option("--with-tests", "Include associated test files")
  .option("--types-only", "Only show types/interfaces (80-90% token savings)")
  .option("--smart", "Smart context selection based on task type")
  .option("--signatures-only", "Only show signatures (minimal context)")
  .option("--lazy", "Lazy loading: only refs, use 'expand' to load content (max token savings)")
  .option("--no-cache", "Disable semantic cache")
  .option("--cache-ttl <minutes>", "Cache TTL in minutes", "15")
  .action(async (question, options) => {
    const rootDir = path.resolve(options.dir);
    const store = loadStore(rootDir);

    if (!store) {
      console.error("No index found.");
      process.exit(1);
    }

    const useCache = options.cache !== false;
    const cacheTTL = parseInt(options.cacheTtl) * 60 * 1000;

    // Try cache first
    if (useCache) {
      const cache = loadCache(rootDir);

      // Clean expired entries occasionally
      if (Date.now() - cache.stats.lastCleanup > cacheTTL) {
        cleanExpired(cache, cacheTTL);
      }

      // 1. Try exact match
      const exactMatch = lookupExact(cache, question, cacheTTL);
      if (exactMatch) {
        recordHit(cache, exactMatch, false);
        saveCache(rootDir, cache);
        // Handle lazy mode for cached results
        if (options.lazy) {
          console.log(formatLazyCachedResults(question, exactMatch.results));
          return;
        }
        console.log(formatCachedResults(exactMatch, question));
        return;
      }

      // 2. Try similarity match (requires embedding)
      await initEmbedder();
      const queryEmbedding = await embed(question);

      const similarMatch = lookupSimilar(cache, queryEmbedding, cacheTTL);
      if (similarMatch) {
        recordHit(cache, similarMatch, true);
        saveCache(rootDir, cache);
        // Handle lazy mode for cached results
        if (options.lazy) {
          console.log(formatLazyCachedResults(question, similarMatch.results));
          return;
        }
        console.log(formatCachedResults(similarMatch, question));
        return;
      }

      // 3. Cache miss - perform search and cache results
      recordMiss(cache);
      const results = search(store, queryEmbedding, parseInt(options.topK), 0.35);

      // Convert to cached format
      const cachedResults: CachedResult[] = results.map(({ chunk, score }) => ({
        filePath: chunk.filePath,
        line: chunk.startLine + 1,
        type: chunk.name ? `${chunk.type}:${chunk.name}` : chunk.type,
        name: chunk.name,
        score,
        content: options.signaturesOnly && chunk.signature ? chunk.signature : chunk.content,
        signature: chunk.signature,
        dependencies: chunk.dependencies,
      }));

      addToCache(cache, question, queryEmbedding, cachedResults);
      saveCache(rootDir, cache);

      // Output results
      console.log(formatResultsWithOptions(question, results, options));
      return;
    }

    // No cache - direct search
    await initEmbedder();
    const queryEmbedding = await embed(question);
    const results = search(store, queryEmbedding, parseInt(options.topK), 0.35);

    // Handle special modes
    if (options.lazy) {
      console.log(formatLazyResults(question, results));
      return;
    }

    if (options.typesOnly) {
      const typeResults = extractTypesOnly(results.map((r) => r.chunk));
      console.log(formatTypesOnly(typeResults));
      return;
    }

    if (options.smart) {
      const graph = loadGraph(rootDir);
      const smartResult = selectSmartContext(question, results, store, graph);
      console.log(formatSmartContext(question, smartResult));
      return;
    }

    // Standard output with optional test context
    let output = formatResultsWithOptions(question, results, options);

    if (options.withTests) {
      const testAssociations = getTestContext(results.map((r) => r.chunk), store);
      if (testAssociations.length > 0) {
        output += "\n" + formatTestContext(testAssociations);
      }
    }

    console.log(output);
  });

/**
 * Format search results with CLI options
 */
function formatResultsWithOptions(
  question: string,
  results: Array<{ chunk: IndexedChunk; score: number }>,
  options: { withDeps?: boolean; signaturesOnly?: boolean }
): string {
  let output = `<rag-context query="${question}">\n`;

  for (const { chunk, score } of results) {
    const header = chunk.name ? `${chunk.type}:${chunk.name}` : chunk.type;

    let attrs = `path="${chunk.filePath}" line="${chunk.startLine + 1}" type="${header}" relevance="${score.toFixed(2)}"`;

    if (chunk.signature) {
      attrs += ` signature="${chunk.signature.replace(/"/g, "'")}"`;
    }

    if (options.withDeps && chunk.dependencies?.length) {
      attrs += ` deps="${chunk.dependencies.join(",")}"`;
    }

    if (chunk.exports) {
      attrs += ` exported="true"`;
    }

    output += `\n<file ${attrs}>\n`;

    if (options.signaturesOnly && chunk.signature) {
      output += chunk.signature;
    } else {
      output += chunk.content;
    }

    output += `\n</file>\n`;
  }

  output += `</rag-context>`;
  return output;
}

/**
 * Format lazy results (refs only, no content)
 */
function formatLazyResults(
  question: string,
  results: Array<{ chunk: IndexedChunk; score: number }>
): string {
  let output = `<lazy-context query="${question}" count="${results.length}">\n`;
  output += `💡 Use \`pnpm rag:expand <ref>\` to load full content\n\n`;

  for (let i = 0; i < results.length; i++) {
    const { chunk, score } = results[i];
    const ref = `${chunk.filePath}:${chunk.startLine + 1}`;
    const type = chunk.name ? `${chunk.type}:${chunk.name}` : chunk.type;
    const sig = chunk.signature ? ` - ${chunk.signature.slice(0, 80)}${chunk.signature.length > 80 ? "..." : ""}` : "";

    output += `[${i + 1}] 📄 ${ref} (${(score * 100).toFixed(0)}%)\n`;
    output += `    ${type}${sig}\n`;
  }

  output += `\n</lazy-context>`;
  output += `\n<!-- Tokens saved: ~${results.reduce((acc, r) => acc + r.chunk.content.length, 0)} chars -->`;
  return output;
}

/**
 * Format lazy results from cached data
 */
function formatLazyCachedResults(
  question: string,
  results: CachedResult[]
): string {
  let output = `<lazy-context query="${question}" count="${results.length}" cached="true">\n`;
  output += `💡 Use \`pnpm rag:expand <ref>\` to load full content\n\n`;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ref = `${r.filePath}:${r.line}`;
    const sig = r.signature ? ` - ${r.signature.slice(0, 80)}${r.signature.length > 80 ? "..." : ""}` : "";

    output += `[${i + 1}] 📄 ${ref} (${(r.score * 100).toFixed(0)}%)\n`;
    output += `    ${r.type}${sig}\n`;
  }

  output += `\n</lazy-context>`;
  output += `\n<!-- Tokens saved: ~${results.reduce((acc, r) => acc + (r.content?.length || 0), 0)} chars -->`;
  return output;
}

program
  .command("expand <ref>")
  .description("Expand a lazy ref to full content (e.g., src/file.ts:42)")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-c, --context <lines>", "Lines of context around match", "10")
  .action(async (ref, options) => {
    const rootDir = path.resolve(options.dir);
    const contextLines = parseInt(options.context);

    // Parse ref: path:line or just path
    const match = ref.match(/^(.+):(\d+)$/);
    let filePath: string;
    let targetLine: number | null = null;

    if (match) {
      filePath = match[1];
      targetLine = parseInt(match[2]);
    } else {
      filePath = ref;
    }

    // Resolve path
    const fullPath = path.resolve(rootDir, filePath);

    try {
      const fs = await import("fs");
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      let output = `<expanded-context ref="${ref}">\n`;
      let linesRead = 0;

      if (targetLine !== null) {
        // Show context around target line
        const start = Math.max(0, targetLine - 1 - contextLines);
        const end = Math.min(lines.length, targetLine - 1 + contextLines + 1);
        linesRead = end - start;

        output += `📄 ${filePath} (lines ${start + 1}-${end})\n\n`;

        for (let i = start; i < end; i++) {
          const prefix = i === targetLine - 1 ? "→ " : "  ";
          output += `${prefix}${i + 1}│ ${lines[i]}\n`;
        }
      } else {
        // Show full file (truncated if too long)
        const maxLines = 100;
        if (lines.length > maxLines) {
          linesRead = maxLines;
          output += `📄 ${filePath} (first ${maxLines} of ${lines.length} lines)\n\n`;
          for (let i = 0; i < maxLines; i++) {
            output += `${i + 1}│ ${lines[i]}\n`;
          }
          output += `\n... ${lines.length - maxLines} more lines ...\n`;
        } else {
          linesRead = lines.length;
          output += `📄 ${filePath} (${lines.length} lines)\n\n`;
          for (let i = 0; i < lines.length; i++) {
            output += `${i + 1}│ ${lines[i]}\n`;
          }
        }
      }

      // Track budget
      const budget = loadBudget(rootDir);
      if (budget) {
        const tokensUsed = estimateTokens(output);
        recordRead(budget, fullPath, linesRead, "chunks", `expand: ${ref}`);
        saveBudget(rootDir, budget);
        output += `\n<!-- Budget: +${tokensUsed} tokens (${budget.consumed}/${budget.totalBudget}) -->`;
      }

      output += `</expanded-context>`;
      console.log(output);
    } catch (err) {
      console.error(`Error reading ${filePath}: ${err}`);
      process.exit(1);
    }
  });

program
  .command("cache")
  .description("Show cache statistics")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--clear", "Clear the cache")
  .action((options) => {
    const rootDir = path.resolve(options.dir);
    const cache = loadCache(rootDir);

    if (options.clear) {
      saveCache(rootDir, {
        version: "1.0.0",
        entries: [],
        stats: { totalQueries: 0, cacheHits: 0, cacheMisses: 0, similarityHits: 0, lastCleanup: Date.now() },
      });
      console.log(chalk.green("Cache cleared."));
      return;
    }

    const stats = getCacheStats(cache);

    console.log(chalk.blue("\n📦 Semantic Cache Statistics\n"));
    console.log(`Cached queries: ${stats.entries}`);
    console.log(`Total queries: ${stats.totalQueries}`);
    console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
    console.log(`  - Exact hits: ${cache.stats.cacheHits}`);
    console.log(`  - Similar hits: ${cache.stats.similarityHits}`);
    console.log(`  - Misses: ${cache.stats.cacheMisses}`);
    console.log(`Avg hits/entry: ${stats.avgHitsPerEntry.toFixed(1)}`);

    if (cache.entries.length > 0) {
      console.log(chalk.yellow("\nTop cached queries:"));
      const topQueries = [...cache.entries]
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 5);
      for (const entry of topQueries) {
        console.log(`  [${entry.hits} hits] "${entry.query.slice(0, 50)}${entry.query.length > 50 ? "..." : ""}"`);
      }
    }
  });

program
  .command("diff")
  .description("Get minimal context from git diff")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-b, --base <ref>", "Base ref to compare from", "HEAD")
  .option("-t, --target <ref>", "Target ref to compare to")
  .option("-s, --staged", "Only show staged changes")
  .option("--files-only", "Only list changed file paths")
  .option("--stats-only", "Only show diff statistics")
  .option("--summary", "Show summary without full hunks")
  .option("--max-lines <number>", "Max lines to output", "500")
  .action((options) => {
    const rootDir = path.resolve(options.dir);
    const branch = getCurrentBranch(rootDir);

    // Files only mode
    if (options.filesOnly) {
      const files = getChangedFiles(rootDir, {
        base: options.base,
        target: options.target,
        staged: options.staged,
      });

      if (files.length === 0) {
        console.log(chalk.yellow("No changed files."));
        return;
      }

      console.log(chalk.blue(`\n📂 Changed files (${files.length}):\n`));
      for (const file of files) {
        console.log(`  ${file}`);
      }
      return;
    }

    // Stats only mode
    if (options.statsOnly) {
      const stats = getDiffStats(rootDir, {
        base: options.base,
        target: options.target,
        staged: options.staged,
      });

      console.log(chalk.blue(`\n📊 Diff Statistics (${branch})\n`));
      console.log(`Files changed: ${stats.files}`);
      console.log(`Insertions: ${chalk.green(`+${stats.insertions}`)}`);
      console.log(`Deletions: ${chalk.red(`-${stats.deletions}`)}`);
      return;
    }

    // Full diff context
    const summary = getDiffContext(rootDir, {
      base: options.base,
      target: options.target,
      staged: options.staged,
    });

    if (summary.files.length === 0) {
      console.log(chalk.yellow("No changes detected."));
      return;
    }

    const output = formatDiffContext(summary, {
      maxLines: parseInt(options.maxLines),
      showFullHunks: !options.summary,
    });

    console.log(output);
  });

program
  .command("memory")
  .description("Manage project memory (compressed context)")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--generate", "Generate/refresh project memory")
  .option("--show", "Show current memory (default)")
  .option("--json", "Output as JSON")
  .option("--force", "Force regeneration even if fresh")
  .action((options) => {
    const rootDir = path.resolve(options.dir);

    // Generate mode
    if (options.generate) {
      console.log(chalk.blue("\n🧠 Generating project memory...\n"));

      const memory = generateMemory(rootDir);
      saveMemory(rootDir, memory);

      console.log(chalk.green("✅ Memory generated and saved to .claude-memory.json\n"));
      console.log(`Project: ${memory.project.name} (${memory.project.type})`);
      console.log(`Stack: ${memory.project.mainTechnologies.join(", ") || "N/A"}`);
      console.log(`Packages: ${memory.project.packages.length}`);
      console.log(`Constraints: ${memory.constraints.length}`);
      console.log(`Branch: ${memory.recentActivity.activeBranch}`);
      return;
    }

    // Show mode (default)
    let memory = loadMemory(rootDir);

    if (!memory) {
      console.log(chalk.yellow("No memory found. Generating..."));
      memory = generateMemory(rootDir);
      saveMemory(rootDir, memory);
    } else if (!options.force && needsRefresh(rootDir, memory)) {
      console.log(chalk.yellow("Memory outdated. Refreshing..."));
      memory = generateMemory(rootDir);
      saveMemory(rootDir, memory);
    }

    if (options.json) {
      console.log(JSON.stringify(memory, null, 2));
    } else {
      console.log(formatMemoryContext(memory));
    }
  });

// ============================================
// PROMPT TEMPLATES
// ============================================

program
  .command("template [id]")
  .description("Use prompt templates for common tasks")
  .option("-c, --category <cat>", "Filter by category (review, debug, refactor, explain, test, docs, implement)")
  .option("-s, --search <query>", "Search templates")
  .option("--suggest <task>", "Suggest templates for a task description")
  .option("--list", "List all templates")
  .action((id, options) => {
    // List all templates
    if (options.list || (!id && !options.category && !options.search && !options.suggest)) {
      const templates = listTemplates().map((t) =>
        getTemplate(t.id)
      ).filter((t): t is PromptTemplate => t !== undefined);
      console.log(formatTemplateList(templates));
      return;
    }

    // Search templates
    if (options.search) {
      const results = searchTemplates(options.search);
      if (results.length === 0) {
        console.log(chalk.yellow("No templates found matching your search."));
        return;
      }
      console.log(formatTemplateList(results));
      return;
    }

    // Suggest templates for a task
    if (options.suggest) {
      const suggestions = suggestTemplates(options.suggest);
      if (suggestions.length === 0) {
        console.log(chalk.yellow("No template suggestions for this task."));
        return;
      }
      console.log(chalk.blue(`\n💡 Suggested templates for: "${options.suggest}"\n`));
      console.log(formatTemplateList(suggestions));
      return;
    }

    // Filter by category
    if (options.category) {
      const templates = getTemplatesByCategory(options.category);
      if (templates.length === 0) {
        console.log(chalk.yellow(`No templates in category: ${options.category}`));
        return;
      }
      console.log(formatTemplateList(templates));
      return;
    }

    // Show specific template
    if (id) {
      const template = getTemplate(id);
      if (!template) {
        console.log(chalk.red(`Template not found: ${id}`));
        console.log(chalk.gray("Use --list to see available templates."));
        return;
      }
      console.log(formatTemplate(template));
    }
  });

// ============================================
// DEPENDENCY GRAPH
// ============================================

program
  .command("deps [file]")
  .description("Analyze dependency graph")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-b, --build", "Build/rebuild the dependency graph")
  .option("-t, --transitive", "Include transitive dependencies")
  .option("-i, --importers", "Show files that import this file")
  .option("--impact", "Show impact analysis for a file")
  .option("--find-export <name>", "Find files that export a name")
  .option("--dead-exports", "Find potentially unused exports")
  .option("--stats", "Show graph statistics")
  .action((file, options) => {
    const rootDir = path.resolve(options.dir);

    // Build graph
    if (options.build) {
      console.log(chalk.blue("\n🔗 Building dependency graph...\n"));
      const store = loadStore(rootDir);
      if (!store) {
        console.log(chalk.red("No index found. Run 'pnpm rag:index' first."));
        return;
      }
      const graph = buildGraph(store, rootDir);
      saveGraph(rootDir, graph);
      console.log(chalk.green("✅ Dependency graph saved to .rag/deps.json"));
      console.log(formatGraphStats(graph));
      return;
    }

    // Load existing graph
    let graph = loadGraph(rootDir);
    if (!graph) {
      console.log(chalk.yellow("No dependency graph found. Building..."));
      const store = loadStore(rootDir);
      if (!store) {
        console.log(chalk.red("No index found. Run 'pnpm rag:index' first."));
        return;
      }
      graph = buildGraph(store, rootDir);
      saveGraph(rootDir, graph);
    }

    // Show stats
    if (options.stats || (!file && !options.findExport && !options.deadExports)) {
      console.log(formatGraphStats(graph));
      return;
    }

    // Find export
    if (options.findExport) {
      const files = findExport(graph, options.findExport);
      if (files.length === 0) {
        console.log(chalk.yellow(`No files export: ${options.findExport}`));
        return;
      }
      console.log(chalk.blue(`\n📦 Files exporting "${options.findExport}":\n`));
      for (const f of files) {
        console.log(`   ${f}`);
      }
      return;
    }

    // Find dead exports
    if (options.deadExports) {
      const dead = findDeadExports(graph);
      if (dead.length === 0) {
        console.log(chalk.green("No potentially dead exports found."));
        return;
      }
      console.log(chalk.yellow(`\n⚠️ Potentially unused exports (${dead.length}):\n`));
      for (const d of dead.slice(0, 20)) {
        console.log(`   ${d.filePath}: ${d.export}`);
      }
      if (dead.length > 20) {
        console.log(`   ... and ${dead.length - 20} more`);
      }
      return;
    }

    // File-specific operations
    if (file) {
      if (options.impact) {
        console.log(formatImpactAnalysis(graph, file));
        return;
      }

      console.log(
        formatFileDependencies(graph, file, {
          transitive: options.transitive,
          showImporters: options.importers,
        })
      );
    }
  });

// ============================================
// INCREMENTAL REINDEX (SMART WATCH)
// ============================================

program
  .command("watch")
  .description("Incremental reindexing (smart file watcher)")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-f, --force", "Force full reindex")
  .option("--check", "Only check for changes, don't reindex")
  .option("--recent [minutes]", "Show recently modified files")
  .option("--no-ast", "Disable AST-based chunking")
  .action(async (options) => {
    const rootDir = path.resolve(options.dir);

    // Check for changes only
    if (options.check) {
      console.log(chalk.blue("\n🔍 Checking for changes...\n"));
      const { hasChanges, changes } = await checkForChanges(rootDir);

      if (!hasChanges) {
        console.log(chalk.green("✅ No changes detected. Index is up to date."));
        return;
      }

      console.log(chalk.yellow("Changes detected:\n"));
      if (changes.added.length > 0) {
        console.log(chalk.green(`  Added (${changes.added.length}):`));
        for (const f of changes.added.slice(0, 10)) {
          console.log(`    + ${f}`);
        }
        if (changes.added.length > 10) {
          console.log(`    ... and ${changes.added.length - 10} more`);
        }
      }
      if (changes.modified.length > 0) {
        console.log(chalk.yellow(`  Modified (${changes.modified.length}):`));
        for (const f of changes.modified.slice(0, 10)) {
          console.log(`    ~ ${f}`);
        }
        if (changes.modified.length > 10) {
          console.log(`    ... and ${changes.modified.length - 10} more`);
        }
      }
      if (changes.deleted.length > 0) {
        console.log(chalk.red(`  Deleted (${changes.deleted.length}):`));
        for (const f of changes.deleted.slice(0, 10)) {
          console.log(`    - ${f}`);
        }
        if (changes.deleted.length > 10) {
          console.log(`    ... and ${changes.deleted.length - 10} more`);
        }
      }
      console.log(chalk.gray("\nRun 'pnpm rag:watch' to update the index."));
      return;
    }

    // Show recently modified files
    if (options.recent !== undefined) {
      const minutes = typeof options.recent === "string" ? parseInt(options.recent) : 60;
      const recent = getRecentlyModified(rootDir, minutes * 60 * 1000);

      if (recent.length === 0) {
        console.log(chalk.yellow(`No files modified in the last ${minutes} minutes.`));
        return;
      }

      console.log(chalk.blue(`\n📝 Recently modified (last ${minutes} minutes):\n`));
      for (const f of recent) {
        console.log(`   ${f}`);
      }
      return;
    }

    // Incremental reindex
    console.log(chalk.blue("\n🔄 Starting incremental reindex...\n"));

    const stats = await incrementalReindex(rootDir, {
      force: options.force,
      useAST: options.ast !== false,
    });

    console.log(formatWatcherStats(stats));

    if (stats.added === 0 && stats.modified === 0 && stats.deleted === 0) {
      console.log(chalk.green("✅ Index already up to date!"));
    } else {
      console.log(chalk.green("✅ Index updated successfully!"));
    }
  });

// ============================================
// AUTO-COMMIT
// ============================================

program
  .command("commit")
  .description("Generate commit message from git diff")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--staged", "Only analyze staged changes (default)")
  .option("--all", "Analyze all changes (staged + unstaged)")
  .option("-y, --yes", "Execute commit without confirmation")
  .option("--dry-run", "Show message without committing")
  .action((options) => {
    const rootDir = path.resolve(options.dir);
    const staged = !options.all;

    // Check for changes
    if (staged && !hasStagedChanges(rootDir)) {
      if (hasUnstagedChanges(rootDir)) {
        console.log(chalk.yellow("\nNo staged changes. Stage files first with 'git add' or use --all.\n"));
        console.log(chalk.gray("Tip: git add -p for interactive staging"));
      } else {
        console.log(chalk.yellow("\nNo changes to commit.\n"));
      }
      return;
    }

    if (!staged && !hasUnstagedChanges(rootDir) && !hasStagedChanges(rootDir)) {
      console.log(chalk.yellow("\nNo changes to commit.\n"));
      return;
    }

    // Generate commit message
    console.log(chalk.blue("\n🔍 Analyzing changes...\n"));
    const suggestion = generateCommitMessage(rootDir, staged);

    console.log(formatCommitSuggestion(suggestion));

    // Dry run mode
    if (options.dryRun) {
      console.log(chalk.gray("\nDry run - no commit made."));
      console.log(chalk.gray(`Command: ${getCommitCommand(suggestion)}`));
      return;
    }

    // Auto-execute or show command
    if (options.yes) {
      console.log(chalk.blue("Executing commit..."));
      const success = executeCommit(rootDir, suggestion);
      if (success) {
        console.log(chalk.green("\n✅ Commit created successfully!"));
      } else {
        console.log(chalk.red("\n❌ Commit failed. Check git status."));
      }
    } else {
      console.log(chalk.gray("\nTo commit with this message, run:"));
      console.log(chalk.cyan(`  ${getCommitCommand(suggestion)}`));
      console.log(chalk.gray("\nOr use: pnpm rag:commit -y"));
    }
  });


// ============================================
// SESSION SUMMARY
// ============================================

program
  .command("session")
  .description("Manage session summary for context continuity")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--show", "Show current session (default)")
  .option("--new", "Start a new session")
  .option("--clear", "Clear session data")
  .option("--compact", "Show compact summary")
  .option("--context <text>", "Set work context description")
  .action((options) => {
    const rootDir = path.resolve(options.dir);

    if (options.clear) {
      clearSession(rootDir);
      console.log(chalk.green("Session cleared."));
      return;
    }

    if (options.new) {
      const session = createSession(rootDir);
      saveSession(rootDir, session);
      console.log(chalk.green(`New session started: ${session.sessionId}`));
      return;
    }

    if (options.context) {
      let session = loadSession(rootDir);
      if (!session) {
        session = createSession(rootDir);
      }
      setWorkContext(session, options.context);
      saveSession(rootDir, session);
      console.log(chalk.green("Work context updated."));
      return;
    }

    // Show session (default)
    const session = generateSummary(rootDir);

    if (options.compact) {
      console.log(formatCompactSummary(session));
    } else {
      console.log(formatSessionSummary(session));
    }
  });

// ============================================
// ERROR PATTERNS DB
// ============================================

program
  .command("errors [action]")
  .description("Manage error patterns database")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-t, --type <type>", "Error type (e.g., TypeError, BuildError)")
  .option("-m, --message <msg>", "Error message")
  .option("-s, --solution <desc>", "Solution description")
  .option("--steps <steps>", "Solution steps (comma-separated)")
  .option("--tags <tags>", "Tags (comma-separated)")
  .option("--severity <level>", "Severity (low, medium, high, critical)", "medium")
  .option("--search <query>", "Search by keyword")
  .option("--tag <tag>", "Search by tag")
  .option("--recent", "Show recent errors")
  .option("--common", "Show most common errors")
  .option("--delete <id>", "Delete pattern by ID")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);
    const db = loadErrorDB(rootDir);

    // Add new pattern
    if (action === "add" || (options.type && options.message && options.solution)) {
      if (!options.type || !options.message || !options.solution) {
        console.log(chalk.red("Required: --type, --message, --solution"));
        return;
      }

      const pattern = addErrorPattern(
        db,
        options.type,
        options.message,
        {
          description: options.solution,
          steps: options.steps ? options.steps.split(",").map((s: string) => s.trim()) : [],
          commands: [],
          preventionTips: [],
        },
        {},
        options.tags ? options.tags.split(",").map((t: string) => t.trim()) : [],
        options.severity as "low" | "medium" | "high" | "critical"
      );

      saveErrorDB(rootDir, db);
      console.log(chalk.green(`Error pattern added: ${pattern.id}`));
      return;
    }

    // Find matching error
    if (action === "find" && options.message) {
      const match = findErrorPattern(db, options.message, options.type);
      if (match) {
        console.log(formatErrorPattern(match));
      } else {
        console.log(chalk.yellow("No matching error pattern found."));
      }
      saveErrorDB(rootDir, db);
      return;
    }

    // Search by keyword
    if (options.search) {
      const results = searchByKeyword(db, options.search);
      console.log(formatErrorList(results));
      return;
    }

    // Search by tag
    if (options.tag) {
      const results = searchByTag(db, options.tag);
      console.log(formatErrorList(results));
      return;
    }

    // Show recent
    if (options.recent) {
      const results = getRecentErrors(db, 10);
      console.log(formatErrorList(results));
      return;
    }

    // Show common
    if (options.common) {
      const results = getMostCommon(db, 10);
      console.log(formatErrorList(results));
      return;
    }

    // Delete pattern
    if (options.delete) {
      if (deletePattern(db, options.delete)) {
        saveErrorDB(rootDir, db);
        console.log(chalk.green(`Pattern ${options.delete} deleted.`));
      } else {
        console.log(chalk.red("Pattern not found."));
      }
      return;
    }

    // Default: show stats
    const stats = getErrorDBStats(db);
    console.log(chalk.blue("\n📊 Error Patterns Database\n"));
    console.log(`Total patterns: ${stats.totalPatterns}`);
    console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
    console.log(`Avg use count: ${stats.avgUseCount.toFixed(1)}`);

    if (stats.topTags.length > 0) {
      console.log(chalk.yellow("\nTop tags:"));
      for (const { tag, count } of stats.topTags) {
        console.log(`  ${tag}: ${count}`);
      }
    }
  });

// ============================================
// CODE SNIPPETS CACHE
// ============================================

program
  .command("snippets [action]")
  .description("Manage code snippets cache")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-n, --name <name>", "Snippet name")
  .option("--desc <description>", "Snippet description")
  .option("--code <code>", "Code content")
  .option("-c, --category <cat>", "Category (component, hook, utility, pattern, test, config, type, api, other)")
  .option("-l, --language <lang>", "Language")
  .option("--tags <tags>", "Tags (comma-separated)")
  .option("--search <query>", "Search snippets")
  .option("--recent", "Show recent snippets")
  .option("--popular", "Show most used snippets")
  .option("--delete <id>", "Delete snippet by ID")
  .option("--get <name>", "Get snippet by name")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);
    const cache = loadSnippetsCache(rootDir);

    // Add new snippet
    if (action === "add" || (options.name && options.code)) {
      if (!options.name || !options.code) {
        console.log(chalk.red("Required: --name, --code"));
        return;
      }

      const snippet = addSnippet(
        cache,
        options.name,
        options.desc || "",
        options.code,
        {
          category: options.category,
          language: options.language,
          tags: options.tags ? options.tags.split(",").map((t: string) => t.trim()) : [],
        }
      );

      saveSnippetsCache(rootDir, cache);
      console.log(chalk.green(`Snippet added: ${snippet.id}`));
      console.log(formatSnippet(snippet));
      return;
    }

    // Get snippet
    if (options.get) {
      const snippet = findSnippet(cache, options.get);
      if (snippet) {
        recordUsage(snippet);
        saveSnippetsCache(rootDir, cache);
        console.log(formatSnippet(snippet));
      } else {
        console.log(chalk.yellow("Snippet not found."));
      }
      return;
    }

    // Search snippets
    if (options.search) {
      const results = searchSnippets(cache, options.search);
      console.log(formatSnippetList(results));
      return;
    }

    // Filter by category
    if (options.category) {
      const results = getByCategory(cache, options.category);
      console.log(formatSnippetList(results));
      return;
    }

    // Show recent
    if (options.recent) {
      const results = getRecentSnippets(cache, 10);
      console.log(formatSnippetList(results));
      return;
    }

    // Show popular
    if (options.popular) {
      const results = getMostUsedSnippets(cache, 10);
      console.log(formatSnippetList(results));
      return;
    }

    // Delete snippet
    if (options.delete) {
      if (deleteSnippet(cache, options.delete)) {
        saveSnippetsCache(rootDir, cache);
        console.log(chalk.green(`Snippet ${options.delete} deleted.`));
      } else {
        console.log(chalk.red("Snippet not found."));
      }
      return;
    }

    // Default: show stats
    const stats = getSnippetStats(cache);
    console.log(chalk.blue("\n📦 Code Snippets Cache\n"));
    console.log(`Total snippets: ${stats.totalSnippets}`);
    console.log(`Total insertions: ${stats.totalInsertions}`);
    console.log(`Avg use count: ${stats.avgUseCount.toFixed(1)}`);

    if (Object.keys(stats.byCategory).length > 0) {
      console.log(chalk.yellow("\nBy category:"));
      for (const [cat, count] of Object.entries(stats.byCategory)) {
        console.log(`  ${cat}: ${count}`);
      }
    }

    if (Object.keys(stats.byLanguage).length > 0) {
      console.log(chalk.yellow("\nBy language:"));
      for (const [lang, count] of Object.entries(stats.byLanguage)) {
        console.log(`  ${lang}: ${count}`);
      }
    }
  });

// ============================================
// READ OPTIMIZER - BUDGET MANAGER
// ============================================

program
  .command("budget [action]")
  .description("Manage read budget for token optimization")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--limit <tokens>", "Set budget limit", "50000")
  .option("--reason <text>", "Justification for budget increase")
  .option("--add <tokens>", "Add tokens to budget")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);

    // Initialize new budget
    if (action === "init" || action === "new") {
      const budget = createBudget();
      budget.totalBudget = parseInt(options.limit);
      saveBudget(rootDir, budget);
      console.log(chalk.green(`✅ Budget initialized: ${budget.totalBudget.toLocaleString()} tokens`));
      console.log(chalk.gray(`Session: ${budget.sessionId}`));
      return;
    }

    // Reset budget
    if (action === "reset") {
      const budget = createBudget();
      budget.totalBudget = parseInt(options.limit);
      saveBudget(rootDir, budget);
      console.log(chalk.green("Budget reset."));
      return;
    }

    // Increase budget with justification
    if (action === "increase" && options.add) {
      let budget = loadBudget(rootDir);
      if (!budget) {
        budget = createBudget();
      }
      const amount = parseInt(options.add);
      const justification = requestBudgetIncrease(budget, options.reason || "Manual increase", amount);
      saveBudget(rootDir, budget);
      console.log(chalk.green(`✅ Budget increased by ${amount.toLocaleString()} tokens`));
      console.log(chalk.gray(`Reason: ${justification.reason}`));
      return;
    }

    // Show budget (default)
    const budget = loadBudget(rootDir);
    if (!budget) {
      console.log(chalk.yellow("No budget initialized. Use 'pnpm rag:budget init'"));
      return;
    }
    console.log(formatBudgetReport(budget));
  });

// ============================================
// READ OPTIMIZER - HYPOTHESIS-DRIVEN READING
// ============================================

program
  .command("hypothesis [action]")
  .description("Manage hypothesis-driven reading sessions")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--task <text>", "Task description for new session")
  .option("--desc <text>", "Hypothesis description")
  .option("--files <files>", "Target files (comma-separated)")
  .option("--symbols <symbols>", "Target symbols (comma-separated)")
  .option("--priority <n>", "Hypothesis priority", "1")
  .option("--id <id>", "Hypothesis ID for validation")
  .option("--evidence <text>", "Evidence for validation")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);

    // Start new session
    if (action === "start" || action === "new") {
      if (!options.task) {
        console.log(chalk.red("Required: --task"));
        return;
      }
      const session = createHypothesisSession(options.task);
      saveHypothesisSession(rootDir, session);
      console.log(chalk.green(`✅ Hypothesis session started: ${session.sessionId}`));
      console.log(chalk.gray(`Task: ${session.task}`));
      return;
    }

    // Add hypothesis
    if (action === "add") {
      const session = loadHypothesisSession(rootDir);
      if (!session) {
        console.log(chalk.red("No active session. Use 'pnpm rag:hypothesis start --task \"...\"'"));
        return;
      }
      if (!options.desc || !options.files) {
        console.log(chalk.red("Required: --desc, --files"));
        return;
      }
      const files = options.files.split(",").map((f: string) => f.trim());
      const symbols = options.symbols ? options.symbols.split(",").map((s: string) => s.trim()) : [];
      const h = addHypothesis(session, options.desc, files, symbols, parseInt(options.priority));
      saveHypothesisSession(rootDir, session);
      console.log(chalk.green(`✅ Hypothesis added: ${h.id}`));
      console.log(chalk.gray(`Description: ${h.description}`));
      console.log(chalk.gray(`Targets: ${h.targetFiles.join(", ")}`));
      return;
    }

    // Validate hypothesis
    if (action === "validate" || action === "reject") {
      const session = loadHypothesisSession(rootDir);
      if (!session) {
        console.log(chalk.red("No active session."));
        return;
      }
      if (!options.id) {
        console.log(chalk.red("Required: --id"));
        return;
      }
      validateHypothesis(session, options.id, action === "validate", options.evidence);
      saveHypothesisSession(rootDir, session);
      console.log(chalk.green(`✅ Hypothesis ${options.id} ${action === "validate" ? "validated" : "rejected"}`));
      return;
    }

    // Check if read is allowed
    if (action === "check" && options.files) {
      const session = loadHypothesisSession(rootDir);
      if (!session) {
        console.log(chalk.green("No hypothesis session - all reads allowed"));
        return;
      }
      const result = isReadAllowedByHypothesis(session, options.files);
      if (result.allowed) {
        console.log(chalk.green(`✅ Read allowed: ${result.reason}`));
      } else {
        console.log(chalk.red(`❌ Read blocked: ${result.reason}`));
      }
      return;
    }

    // Clear session
    if (action === "clear") {
      const filePath = path.join(rootDir, ".rag-hypothesis.json");
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(chalk.green("Hypothesis session cleared."));
      }
      return;
    }

    // Show status (default)
    const session = loadHypothesisSession(rootDir);
    if (!session) {
      console.log(chalk.yellow("No active hypothesis session."));
      return;
    }
    console.log(formatHypothesisReport(session));
  });

// ============================================
// READ OPTIMIZER - CONTEXT STATE
// ============================================

program
  .command("context-lock [action]")
  .description("Manage context refusal mode")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--reason <text>", "Reason for locking context")
  .option("--file <path>", "File to check/override")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);

    // Lock context
    if (action === "lock") {
      let state = loadContextState(rootDir);
      if (!state) {
        state = createContextState();
      }
      declareSufficientContext(state, options.reason || "Context declared sufficient");
      saveContextState(rootDir, state);
      console.log(chalk.green("🔒 Context locked - further reads blocked"));
      console.log(chalk.gray(`Reason: ${state.reason}`));
      return;
    }

    // Unlock context
    if (action === "unlock") {
      const state = loadContextState(rootDir);
      if (!state) {
        console.log(chalk.yellow("No context state found."));
        return;
      }
      unlockContext(state);
      saveContextState(rootDir, state);
      console.log(chalk.green("🔓 Context unlocked - reads allowed"));
      return;
    }

    // Add override for specific file
    if (action === "override" && options.file) {
      let state = loadContextState(rootDir);
      if (!state) {
        state = createContextState();
      }
      addContextOverride(state, options.file, options.reason || "Manual override");
      saveContextState(rootDir, state);
      console.log(chalk.green(`✅ Override added for: ${options.file}`));
      return;
    }

    // Check if read is allowed
    if (action === "check" && options.file) {
      const state = loadContextState(rootDir);
      if (!state || !state.sufficientContext) {
        console.log(chalk.green("✅ Context open - read allowed"));
        return;
      }
      const result = attemptContextRead(state, options.file);
      if (result.allowed) {
        console.log(chalk.green(`✅ Read allowed: ${result.reason}`));
      } else {
        console.log(chalk.red(`❌ Read blocked: ${result.reason}`));
      }
      return;
    }

    // Show status (default)
    const state = loadContextState(rootDir);
    if (!state) {
      console.log(chalk.green("🔓 No context lock active"));
      return;
    }
    console.log(formatContextState(state));
  });

// ============================================
// READ OPTIMIZER - RUNTIME PATH PRUNING
// ============================================

program
  .command("prune-path")
  .description("Analyze stack trace and prune irrelevant files")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-s, --stack <trace>", "Stack trace to analyze")
  .option("-f, --file <path>", "Read stack trace from file")
  .action((options) => {
    const rootDir = path.resolve(options.dir);

    let stackTrace = options.stack;
    if (options.file && fs.existsSync(options.file)) {
      stackTrace = fs.readFileSync(options.file, "utf-8");
    }

    if (!stackTrace) {
      console.log(chalk.red("Required: --stack or --file"));
      console.log(chalk.gray("Example: pnpm rag:prune-path --stack \"Error: ...\\n    at foo (src/a.ts:10:5)\""));
      return;
    }

    const store = loadStore(rootDir);
    const allFiles = store ? store.chunks.map(c => c.filePath) : [];
    const uniqueFiles = [...new Set(allFiles)];

    const result = analyzeRuntimePath(stackTrace, uniqueFiles, rootDir);
    console.log(formatRuntimePath(result));
  });

// ============================================
// READ OPTIMIZER - API CONTRACTS
// ============================================

program
  .command("contracts [action]")
  .description("Manage API contract snapshots")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-f, --file <path>", "File to snapshot/check")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);

    // Build/update snapshot
    if (action === "snapshot" || action === "update") {
      let snapshot = loadContractSnapshot(rootDir);
      if (!snapshot) {
        snapshot = createContractSnapshot();
      }

      if (options.file) {
        const filePath = path.resolve(options.file);
        if (!fs.existsSync(filePath)) {
          console.log(chalk.red(`File not found: ${filePath}`));
          return;
        }
        const { contract, diff } = updateContractSnapshot(snapshot, filePath);
        saveContractSnapshot(rootDir, snapshot);
        console.log(chalk.green(`✅ Contract captured: ${contract.signatures.length} signatures`));
        console.log(formatContractDiff(diff, filePath));
      } else {
        // Snapshot all indexed files
        const store = loadStore(rootDir);
        if (!store) {
          console.log(chalk.red("No index found."));
          return;
        }
        const files = [...new Set(store.chunks.map(c => c.filePath))];
        let count = 0;
        for (const file of files) {
          const fullPath = path.join(rootDir, file);
          if (fs.existsSync(fullPath) && (file.endsWith(".ts") || file.endsWith(".tsx"))) {
            updateContractSnapshot(snapshot, fullPath);
            count++;
          }
        }
        saveContractSnapshot(rootDir, snapshot);
        console.log(chalk.green(`✅ Contracts captured for ${count} files`));
      }
      return;
    }

    // Check if contract changed
    if (action === "check" && options.file) {
      const snapshot = loadContractSnapshot(rootDir);
      if (!snapshot) {
        console.log(chalk.yellow("No contract snapshot. Use 'pnpm rag:contracts snapshot'"));
        return;
      }
      const filePath = path.resolve(options.file);
      const changed = hasContractChanged(snapshot, filePath);
      if (changed) {
        const { diff } = updateContractSnapshot(snapshot, filePath);
        console.log(chalk.yellow(`⚠️ Contract changed for: ${options.file}`));
        console.log(formatContractDiff(diff, filePath));
      } else {
        console.log(chalk.green(`✅ Contract unchanged: ${options.file}`));
      }
      return;
    }

    // Show stats (default)
    const snapshot = loadContractSnapshot(rootDir);
    if (!snapshot) {
      console.log(chalk.yellow("No contract snapshot found."));
      return;
    }
    const fileCount = Object.keys(snapshot.files).length;
    const sigCount = Object.values(snapshot.files).reduce((acc, f) => acc + f.signatures.length, 0);
    console.log(chalk.blue(`\n📜 API Contract Snapshot\n`));
    console.log(`Files tracked: ${fileCount}`);
    console.log(`Total signatures: ${sigCount}`);
    console.log(`Created: ${new Date(snapshot.createdAt).toLocaleString()}`);
  });

// ============================================
// READ OPTIMIZER - LOCALITY SCORE
// ============================================

program
  .command("locality [file]")
  .description("Calculate error locality scores for files")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-k, --top-k <n>", "Show top K files", "10")
  .option("--threshold <score>", "Minimum score threshold", "25")
  .action((file, options) => {
    const rootDir = path.resolve(options.dir);

    const store = loadStore(rootDir);
    if (!store) {
      console.log(chalk.red("No index found."));
      return;
    }

    const graph = loadGraph(rootDir);
    const errorDB = loadErrorDB(rootDir);
    const changedFiles = getChangedFiles(rootDir);

    // Score single file
    if (file) {
      const filePath = path.resolve(rootDir, file);
      const score = calculateLocalityScore(filePath, {
        changedFiles,
        graph: graph || undefined,
        errorDB: errorDB || undefined,
      });
      console.log(chalk.blue(`\n🎯 Locality Score: ${path.basename(file)}\n`));
      console.log(`Total score: ${score.score}/100`);
      console.log(`  Recency: ${score.factors.recency}/25`);
      console.log(`  Diff proximity: ${score.factors.diffProximity}/25`);
      console.log(`  Error history: ${score.factors.errorHistory}/25`);
      console.log(`  Centrality: ${score.factors.centrality}/25`);
      return;
    }

    // Rank all files
    const files = [...new Set(store.chunks.map(c => path.join(rootDir, c.filePath)))];
    const scores = rankFilesByLocality(files, {
      changedFiles,
      graph: graph || undefined,
      errorDB: errorDB || undefined,
    });

    console.log(formatLocalityReport(scores.slice(0, parseInt(options.topK))));
  });

// ============================================
// READ OPTIMIZER - IMPORTANCE INDEX
// ============================================

program
  .command("importance [action]")
  .description("Manage file importance index")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-k, --top-k <n>", "Number of top files", "30")
  .option("-f, --file <path>", "Check specific file")
  .action((action, options) => {
    const rootDir = path.resolve(options.dir);

    // Build index
    if (action === "build" || action === "rebuild") {
      console.log(chalk.blue("\n⭐ Building importance index...\n"));
      const index = buildImportanceIndex(rootDir, parseInt(options.topK));
      saveImportanceIndex(rootDir, index);
      console.log(chalk.green(`✅ Index built: ${index.files.length} files ranked`));
      console.log(formatImportanceReport(index));
      return;
    }

    // Check if file is in top-K
    if (action === "check" && options.file) {
      const index = loadImportanceIndex(rootDir);
      if (!index) {
        console.log(chalk.yellow("No importance index. Use 'pnpm rag:importance build'"));
        return;
      }
      const inTop = isInTopK(index, options.file, parseInt(options.topK));
      if (inTop) {
        console.log(chalk.green(`✅ ${options.file} is in top-${options.topK}`));
      } else {
        console.log(chalk.yellow(`⚠️ ${options.file} is NOT in top-${options.topK}`));
      }
      return;
    }

    // Show index (default)
    let index = loadImportanceIndex(rootDir);
    if (!index) {
      console.log(chalk.yellow("No importance index found. Building..."));
      index = buildImportanceIndex(rootDir, parseInt(options.topK));
      saveImportanceIndex(rootDir, index);
    }
    console.log(formatImportanceReport(index));
  });

// ============================================
// READ OPTIMIZER - RISK ASSESSMENT
// ============================================

program
  .command("risk [file]")
  .description("Assess security/performance risk of files")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("--diff", "Assess risk of changed files in diff")
  .option("--min-level <level>", "Minimum risk level to show (minimal, low, medium, high, critical)", "low")
  .action((file, options) => {
    const rootDir = path.resolve(options.dir);

    // Assess diff
    if (options.diff) {
      const assessments = assessDiffRisk(rootDir);
      if (assessments.length === 0) {
        console.log(chalk.yellow("No changed files to assess."));
        return;
      }
      console.log(formatRiskReport(assessments));
      return;
    }

    // Assess single file
    if (file) {
      const filePath = path.resolve(rootDir, file);
      if (!fs.existsSync(filePath)) {
        console.log(chalk.red(`File not found: ${file}`));
        return;
      }
      const assessment = assessFileRisk(filePath);
      console.log(chalk.blue(`\n🛡️ Risk Assessment: ${path.basename(file)}\n`));
      console.log(`Risk Level: ${assessment.riskLevel.toUpperCase()}`);
      console.log(`Risk Score: ${assessment.riskScore}/100`);
      console.log(`\nFactors:`);
      console.log(`  Security: ${assessment.factors.security}/25`);
      console.log(`  Performance: ${assessment.factors.performance}/25`);
      console.log(`  Complexity: ${assessment.factors.complexity}/25`);
      console.log(`  External: ${assessment.factors.external}/25`);
      console.log(`  Data handling: ${assessment.factors.dataHandling}/25`);

      if (assessment.matches.length > 0) {
        console.log(`\nMatches (${assessment.matches.length}):`);
        for (const m of assessment.matches.slice(0, 10)) {
          console.log(`  L${m.line} [${m.category}]: ${m.context.slice(0, 50)}...`);
        }
      }
      return;
    }

    // Assess all indexed files
    const store = loadStore(rootDir);
    if (!store) {
      console.log(chalk.red("No index found."));
      return;
    }
    const files = [...new Set(store.chunks.map(c => path.join(rootDir, c.filePath)))];
    const assessments = files
      .filter(f => fs.existsSync(f))
      .map(f => assessFileRisk(f));

    console.log(formatRiskReport(assessments));
  });

// ============================================
// READ OPTIMIZER - UNIFIED STATUS
// ============================================

program
  .command("optimizer")
  .description("Show read optimizer status and check read permissions")
  .option("-d, --dir <path>", "Root directory", ".")
  .option("-f, --file <path>", "Check if read is allowed for file")
  .action((options) => {
    const rootDir = path.resolve(options.dir);

    // Check specific file
    if (options.file) {
      const filePath = path.resolve(options.file);
      const decision = shouldAllowRead(filePath, rootDir);

      console.log(chalk.blue(`\n🔧 Read Decision: ${path.basename(options.file)}\n`));
      if (decision.allowed) {
        console.log(chalk.green(`✅ Read allowed (score: ${decision.score}/100)`));
      } else {
        console.log(chalk.red(`❌ Read blocked: ${decision.reason}`));
      }

      if (decision.budgetImpact) {
        console.log(chalk.gray(`Budget impact: ~${decision.budgetImpact} tokens`));
      }

      if (decision.suggestions && decision.suggestions.length > 0) {
        console.log(chalk.yellow(`\n💡 Suggestions:`));
        for (const s of decision.suggestions) {
          console.log(`   • ${s}`);
        }
      }
      return;
    }

    // Show overall status
    console.log(formatOptimizerStatus(rootDir));
  });

program.parse();

#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import * as path from "path";
import * as readline from "readline";
import { initEmbedder, embed } from "./embedder.js";
import { loadStore, search, formatSearchResults } from "./store.js";
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
  fillTemplate,
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
  getImporters,
  getDependencies,
  findExport,
  findDeadExports,
  getImpactAnalysis,
  formatGraphStats,
  formatFileDependencies,
  formatImpactAnalysis,
} from "./dependency-graph.js";
import {
  incrementalReindex,
  checkForChanges,
  needsReindex,
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
  detectTaskType,
} from "./smart-context.js";
import {
  generateCommitMessage,
  formatCommitSuggestion,
  getCommitCommand,
  executeCommit,
  hasStagedChanges,
  hasUnstagedChanges,
} from "./auto-commit.js";
import {  loadSession,  saveSession,  createSession,  generateSummary,  formatSessionSummary,  formatCompactSummary,  clearSession,  isSessionStale,  setWorkContext,} from "./session-summary.js";import {  loadErrorDB,  saveErrorDB,  addErrorPattern,  findErrorPattern,  searchByKeyword,  searchByTag,  getMostCommon,  getRecentErrors,  deletePattern,  formatErrorPattern,  formatErrorList,  getDBStats as getErrorDBStats,} from "./error-patterns.js";import {  loadSnippetsCache,  saveSnippetsCache,  addSnippet,  findSnippet,  searchSnippets,  getByCategory,  getMostUsed as getMostUsedSnippets,  getRecentSnippets,  deleteSnippet,  formatSnippet,  formatSnippetList,  getCacheStats as getSnippetStats,  recordUsage,  fillSnippet,} from "./snippets-cache.js";

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
  results: Array<{ chunk: any; score: number }>,
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
      console.log(chalk.green("✅ Dependency graph saved to .rag-deps.json"));
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

program.parse();

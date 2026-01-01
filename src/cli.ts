#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import * as path from "path";
import { scanDirectory } from "./scanner.js";
import { chunkFile } from "./chunker.js";
import { initEmbedder, embed } from "./embedder.js";
import { saveStore, loadStore, type VectorStore, type IndexedChunk } from "./store.js";

program
  .name("rag-index")
  .description("Local RAG indexer for Claude Code")
  .version("1.0.0");

program
  .command("index")
  .description("Index the codebase for RAG search")
  .option("-d, --dir <path>", "Root directory to index", ".")
  .option("-f, --force", "Force reindex all files")
  .option("--no-ast", "Disable AST-based chunking (use regex fallback)")
  .action(async (options) => {
    const rootDir = path.resolve(options.dir);
    const useAST = options.ast !== false;

    console.log(chalk.blue(`\n📁 Indexing codebase: ${rootDir}\n`));
    if (!useAST) {
      console.log(chalk.yellow("⚠️  AST chunking disabled, using regex fallback"));
    }

    const existingStore = options.force ? null : loadStore(rootDir);

    console.log(chalk.yellow("🔍 Scanning files..."));
    const files = await scanDirectory(rootDir);
    console.log(chalk.green(`   Found ${files.length} files`));

    console.log(chalk.yellow("📄 Chunking files..."));
    const allChunks: Array<{ chunk: ReturnType<typeof chunkFile>[0]; file: string }> = [];
    for (const file of files) {
      const chunks = chunkFile(file.relativePath, file.content, { useAST });
      for (const chunk of chunks) {
        allChunks.push({ chunk, file: file.relativePath });
      }
    }
    console.log(chalk.green(`   Created ${allChunks.length} chunks`));

    await initEmbedder();

    console.log(chalk.yellow("🧠 Generating embeddings..."));
    const indexedChunks: IndexedChunk[] = [];
    let processed = 0;

    for (const { chunk } of allChunks) {
      const existingChunk = existingStore?.chunks.find(
        (c) => c.id === chunk.id && c.content === chunk.content
      );

      if (existingChunk) {
        indexedChunks.push(existingChunk);
      } else {
        const embedding = await embed(chunk.content);
        indexedChunks.push({ ...chunk, embedding });
      }

      processed++;
      if (processed % 50 === 0 || processed === allChunks.length) {
        process.stdout.write(`\r   Progress: ${processed}/${allChunks.length}`);
      }
    }
    console.log();

    const store: VectorStore = {
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      chunks: indexedChunks,
    };

    saveStore(rootDir, store);

    console.log(chalk.green(`\n✅ Index saved to .rag-index.json`));
    console.log(chalk.blue(`   Total chunks: ${indexedChunks.length}`));
    console.log(chalk.blue(`   Total files: ${files.length}`));
  });

program
  .command("stats")
  .description("Show index statistics")
  .option("-d, --dir <path>", "Root directory", ".")
  .action((options) => {
    const rootDir = path.resolve(options.dir);
    const store = loadStore(rootDir);

    if (!store) {
      console.log(chalk.red("No index found. Run 'rag-index index' first."));
      return;
    }

    const fileCount = new Set(store.chunks.map((c) => c.filePath)).size;
    const typeStats = store.chunks.reduce(
      (acc, c) => {
        acc[c.type] = (acc[c.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // AST-specific stats
    const withSignatures = store.chunks.filter((c) => c.signature).length;
    const withDependencies = store.chunks.filter((c) => c.dependencies?.length).length;
    const exportedChunks = store.chunks.filter((c) => c.exports).length;
    const totalDeps = store.chunks.reduce((sum, c) => sum + (c.dependencies?.length || 0), 0);
    const totalChars = store.chunks.reduce((sum, c) => sum + c.content.length, 0);
    const avgChunkSize = Math.round(totalChars / store.chunks.length);

    console.log(chalk.blue("\n📊 Index Statistics\n"));
    console.log(`Created: ${store.createdAt}`);
    console.log(`Total chunks: ${store.chunks.length}`);
    console.log(`Total files: ${fileCount}`);
    console.log(`Avg chunk size: ${avgChunkSize} chars`);

    console.log(chalk.yellow("\nChunk types:"));
    for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    console.log(chalk.yellow("\nAST enrichment:"));
    console.log(`  With signatures: ${withSignatures} (${((withSignatures / store.chunks.length) * 100).toFixed(1)}%)`);
    console.log(`  With dependencies: ${withDependencies} (${((withDependencies / store.chunks.length) * 100).toFixed(1)}%)`);
    console.log(`  Exported: ${exportedChunks}`);
    console.log(`  Total deps tracked: ${totalDeps}`);
  });

program.parse();

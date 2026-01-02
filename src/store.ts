import * as fs from "fs";
import { type Chunk } from "./chunker.js";
import { cosineSimilarity } from "./embedder.js";
import { getRagPath, ensureRagDir } from "./paths.js";

export interface IndexedChunk extends Chunk {
  embedding: number[];
  // New AST fields are inherited from Chunk:
  // signature?: string;
  // dependencies?: string[];
  // exports?: boolean;
}

export interface VectorStore {
  version: string;
  createdAt: string;
  chunks: IndexedChunk[];
}

export function getStorePath(rootDir: string): string {
  return getRagPath(rootDir, "INDEX");
}

export function loadStore(rootDir: string): VectorStore | null {
  const storePath = getStorePath(rootDir);
  if (!fs.existsSync(storePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(storePath, "utf-8");
    return JSON.parse(data) as VectorStore;
  } catch {
    return null;
  }
}

export function saveStore(rootDir: string, store: VectorStore): void {
  ensureRagDir(rootDir);
  const storePath = getStorePath(rootDir);
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function search(
  store: VectorStore,
  queryEmbedding: number[],
  topK: number = 10,
  minScore: number = 0.3
): Array<{ chunk: IndexedChunk; score: number }> {
  const results: Array<{ chunk: IndexedChunk; score: number }> = [];

  for (const chunk of store.chunks) {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (score >= minScore) {
      results.push({ chunk, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function formatSearchResults(
  results: Array<{ chunk: IndexedChunk; score: number }>
): string {
  if (results.length === 0) {
    return "No relevant code found.";
  }

  let output = `Found ${results.length} relevant code sections:\n\n`;

  for (const { chunk, score } of results) {
    const header = chunk.name
      ? `${chunk.type} ${chunk.name}`
      : `${chunk.type}`;
    output += `--- ${chunk.filePath}:${chunk.startLine + 1} (${header}) [score: ${score.toFixed(3)}] ---\n`;
    output += chunk.content + "\n\n";
  }

  return output;
}

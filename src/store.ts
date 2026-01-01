import * as fs from "fs";
import * as path from "path";
import { type Chunk } from "./chunker.js";
import { cosineSimilarity } from "./embedder.js";

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

const STORE_FILE = ".rag-index.json";

export function getStorePath(rootDir: string): string {
  return path.join(rootDir, STORE_FILE);
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

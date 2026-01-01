import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

let embedder: FeatureExtractionPipeline | null = null;

export async function initEmbedder(): Promise<void> {
  if (embedder) return;
  console.log("Loading local embedding model (all-MiniLM-L6-v2)...");
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("Embedding model loaded!");
}

export async function embed(text: string): Promise<number[]> {
  if (!embedder) {
    await initEmbedder();
  }
  const output = await embedder!(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { cosineSimilarity } from "./embedder.js";

export interface CacheEntry {
  query: string;
  normalizedQuery: string;
  queryHash: string;
  embedding: number[];
  results: CachedResult[];
  createdAt: number;
  hits: number;
}

export interface CachedResult {
  filePath: string;
  line: number;
  type: string;
  name?: string;
  score: number;
  content: string;
  signature?: string;
  dependencies?: string[];
}

export interface SemanticCache {
  version: string;
  entries: CacheEntry[];
  stats: CacheStats;
}

export interface CacheStats {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  similarityHits: number;
  lastCleanup: number;
}

const CACHE_FILE = ".rag-cache.json";
const CACHE_VERSION = "1.0.0";
const DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 100; // Max entries
const SIMILARITY_THRESHOLD = 0.92; // For "similar enough" queries

/**
 * Normalize a query for consistent hashing
 * - Lowercase
 * - Remove extra whitespace
 * - Sort words alphabetically (for word-order invariance)
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .sort()
    .join(" ");
}

/**
 * Hash a normalized query
 */
export function hashQuery(normalizedQuery: string): string {
  return crypto.createHash("sha256").update(normalizedQuery).digest("hex").slice(0, 16);
}

/**
 * Get cache file path
 */
export function getCachePath(rootDir: string): string {
  return path.join(rootDir, CACHE_FILE);
}

/**
 * Load cache from disk
 */
export function loadCache(rootDir: string): SemanticCache {
  const cachePath = getCachePath(rootDir);

  if (!fs.existsSync(cachePath)) {
    return createEmptyCache();
  }

  try {
    const data = fs.readFileSync(cachePath, "utf-8");
    const cache = JSON.parse(data) as SemanticCache;

    // Version check
    if (cache.version !== CACHE_VERSION) {
      return createEmptyCache();
    }

    return cache;
  } catch {
    return createEmptyCache();
  }
}

/**
 * Save cache to disk
 */
export function saveCache(rootDir: string, cache: SemanticCache): void {
  const cachePath = getCachePath(rootDir);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * Create empty cache
 */
function createEmptyCache(): SemanticCache {
  return {
    version: CACHE_VERSION,
    entries: [],
    stats: {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      similarityHits: 0,
      lastCleanup: Date.now(),
    },
  };
}

/**
 * Look up cache by exact hash match
 */
export function lookupExact(cache: SemanticCache, query: string, ttl: number = DEFAULT_TTL): CacheEntry | null {
  const normalized = normalizeQuery(query);
  const hash = hashQuery(normalized);
  const now = Date.now();

  const entry = cache.entries.find((e) => e.queryHash === hash && now - e.createdAt < ttl);

  return entry || null;
}

/**
 * Look up cache by semantic similarity
 * Returns the most similar cached query if above threshold
 */
export function lookupSimilar(
  cache: SemanticCache,
  queryEmbedding: number[],
  ttl: number = DEFAULT_TTL,
  threshold: number = SIMILARITY_THRESHOLD
): CacheEntry | null {
  const now = Date.now();
  let bestMatch: CacheEntry | null = null;
  let bestScore = 0;

  for (const entry of cache.entries) {
    // Skip expired entries
    if (now - entry.createdAt >= ttl) continue;

    const similarity = cosineSimilarity(queryEmbedding, entry.embedding);

    if (similarity > threshold && similarity > bestScore) {
      bestScore = similarity;
      bestMatch = entry;
    }
  }

  return bestMatch;
}

/**
 * Add entry to cache
 */
export function addToCache(
  cache: SemanticCache,
  query: string,
  embedding: number[],
  results: CachedResult[]
): CacheEntry {
  const normalized = normalizeQuery(query);
  const hash = hashQuery(normalized);

  // Check if already exists
  const existingIndex = cache.entries.findIndex((e) => e.queryHash === hash);
  if (existingIndex !== -1) {
    // Update existing entry
    cache.entries[existingIndex].results = results;
    cache.entries[existingIndex].createdAt = Date.now();
    cache.entries[existingIndex].hits++;
    return cache.entries[existingIndex];
  }

  const entry: CacheEntry = {
    query,
    normalizedQuery: normalized,
    queryHash: hash,
    embedding,
    results,
    createdAt: Date.now(),
    hits: 0,
  };

  cache.entries.push(entry);

  // Enforce max size (LRU eviction)
  if (cache.entries.length > MAX_CACHE_SIZE) {
    evictLRU(cache);
  }

  return entry;
}

/**
 * Evict least recently used entries
 */
function evictLRU(cache: SemanticCache): void {
  // Sort by (hits * recency factor)
  const now = Date.now();
  cache.entries.sort((a, b) => {
    const scoreA = a.hits * Math.exp(-(now - a.createdAt) / DEFAULT_TTL);
    const scoreB = b.hits * Math.exp(-(now - b.createdAt) / DEFAULT_TTL);
    return scoreB - scoreA;
  });

  // Keep top entries
  cache.entries = cache.entries.slice(0, MAX_CACHE_SIZE * 0.8);
}

/**
 * Clean expired entries
 */
export function cleanExpired(cache: SemanticCache, ttl: number = DEFAULT_TTL): number {
  const now = Date.now();
  const before = cache.entries.length;

  cache.entries = cache.entries.filter((e) => now - e.createdAt < ttl);
  cache.stats.lastCleanup = now;

  return before - cache.entries.length;
}

/**
 * Get cache statistics
 */
export function getCacheStats(cache: SemanticCache): {
  entries: number;
  totalQueries: number;
  hitRate: number;
  similarityHitRate: number;
  avgHitsPerEntry: number;
} {
  const totalHits = cache.stats.cacheHits + cache.stats.similarityHits;
  const hitRate = cache.stats.totalQueries > 0 ? totalHits / cache.stats.totalQueries : 0;
  const similarityHitRate = totalHits > 0 ? cache.stats.similarityHits / totalHits : 0;
  const avgHits = cache.entries.length > 0
    ? cache.entries.reduce((sum, e) => sum + e.hits, 0) / cache.entries.length
    : 0;

  return {
    entries: cache.entries.length,
    totalQueries: cache.stats.totalQueries,
    hitRate,
    similarityHitRate,
    avgHitsPerEntry: avgHits,
  };
}

/**
 * Record a cache hit
 */
export function recordHit(cache: SemanticCache, entry: CacheEntry, isSimilarity: boolean): void {
  cache.stats.totalQueries++;
  if (isSimilarity) {
    cache.stats.similarityHits++;
  } else {
    cache.stats.cacheHits++;
  }
  entry.hits++;
}

/**
 * Record a cache miss
 */
export function recordMiss(cache: SemanticCache): void {
  cache.stats.totalQueries++;
  cache.stats.cacheMisses++;
}

/**
 * Format cache entry for output
 */
export function formatCachedResults(entry: CacheEntry, query: string): string {
  const isSimilar = normalizeQuery(query) !== entry.normalizedQuery;
  let output = `<rag-context query="${query}"${isSimilar ? ` cached-from="${entry.query}"` : ""} cached="true">\n`;

  for (const result of entry.results) {
    let attrs = `path="${result.filePath}" line="${result.line}" type="${result.type}" relevance="${result.score.toFixed(2)}"`;

    if (result.signature) {
      attrs += ` signature="${result.signature.replace(/"/g, "'")}"`;
    }
    if (result.dependencies?.length) {
      attrs += ` deps="${result.dependencies.join(",")}"`;
    }

    output += `\n<file ${attrs}>\n`;
    output += result.content;
    output += `\n</file>\n`;
  }

  output += `</rag-context>`;
  return output;
}

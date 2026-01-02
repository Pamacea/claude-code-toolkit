import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getRagPath, ensureRagDir } from "./paths.js";

export interface CodeSnippet {
  id: string;
  name: string;
  description: string;
  language: string;
  code: string;
  normalizedCode: string;
  category: SnippetCategory;
  usage: SnippetUsage;
  metadata: SnippetMetadata;
}

export type SnippetCategory =
  | "component"
  | "hook"
  | "utility"
  | "pattern"
  | "test"
  | "config"
  | "type"
  | "api"
  | "other";

export interface SnippetUsage {
  useCount: number;
  lastUsed: number;
  insertedIn: string[]; // Files where this snippet was used
}

export interface SnippetMetadata {
  createdAt: number;
  updatedAt: number;
  tags: string[];
  variables: SnippetVariable[];
  sourceFile?: string;
  author?: string;
}

export interface SnippetVariable {
  name: string;
  description: string;
  defaultValue?: string;
}

export interface SnippetsCache {
  version: string;
  snippets: CodeSnippet[];
  stats: CacheStats;
}

export interface CacheStats {
  totalSnippets: number;
  totalInsertions: number;
  lastUpdated: number;
}

const CACHE_VERSION = "1.0.0";
const MAX_SNIPPETS = 150;

/**
 * Get cache file path
 */
export function getCachePath(rootDir: string): string {
  return getRagPath(rootDir, "SNIPPETS");
}

/**
 * Normalize code for comparison
 */
export function normalizeCode(code: string): string {
  return code
    .replace(/\/\/.*$/gm, "") // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/["'`]/g, "'") // Normalize quotes
    .trim()
    .slice(0, 500);
}

/**
 * Generate snippet ID
 */
export function generateSnippetId(name: string, code: string): string {
  const hash = crypto.createHash("sha256")
    .update(`${name}:${normalizeCode(code)}`)
    .digest("hex")
    .slice(0, 10);
  return `snip_${hash}`;
}

/**
 * Detect language from file extension or code
 */
export function detectLanguage(code: string, filename?: string): string {
  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "tsx",
      ".js": "javascript",
      ".jsx": "jsx",
      ".css": "css",
      ".scss": "scss",
      ".json": "json",
      ".md": "markdown",
      ".html": "html",
      ".vue": "vue",
      ".svelte": "svelte",
    };
    if (langMap[ext]) return langMap[ext];
  }

  // Detect from code patterns
  if (code.includes("interface ") || code.includes(": string") || code.includes("<T>")) {
    return "typescript";
  }
  if (code.includes("useState") || code.includes("useEffect") || code.includes("React.")) {
    return code.includes(": ") ? "tsx" : "jsx";
  }
  if (code.includes("function ") || code.includes("const ") || code.includes("=>")) {
    return "javascript";
  }

  return "text";
}

/**
 * Detect snippet category from code
 */
export function detectCategory(code: string, name: string): SnippetCategory {
  const nameLower = name.toLowerCase();
  const codeLower = code.toLowerCase();

  if (nameLower.includes("hook") || code.includes("use") && code.includes("useState")) {
    return "hook";
  }
  if (codeLower.includes("export default function") || codeLower.includes("export const") && codeLower.includes("return (")) {
    return "component";
  }
  if (nameLower.includes("test") || codeLower.includes("describe(") || codeLower.includes("it(") || codeLower.includes("expect(")) {
    return "test";
  }
  if (nameLower.includes("type") || codeLower.includes("interface ") || codeLower.includes("type ")) {
    return "type";
  }
  if (nameLower.includes("util") || nameLower.includes("helper")) {
    return "utility";
  }
  if (nameLower.includes("api") || codeLower.includes("fetch(") || codeLower.includes("axios")) {
    return "api";
  }
  if (nameLower.includes("config") || codeLower.includes("module.exports") || codeLower.includes("export default {")) {
    return "config";
  }
  if (codeLower.includes("pattern") || nameLower.includes("pattern")) {
    return "pattern";
  }

  return "other";
}

/**
 * Extract variables from snippet (${variableName})
 */
export function extractVariables(code: string): SnippetVariable[] {
  const variables: SnippetVariable[] = [];
  const regex = /\$\{(\w+)(?::([^}]*))?\}/g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const name = match[1];
    const defaultValue = match[2];

    if (!variables.find((v) => v.name === name)) {
      variables.push({
        name,
        description: `Variable: ${name}`,
        defaultValue,
      });
    }
  }

  return variables;
}

/**
 * Load snippets cache
 */
export function loadSnippetsCache(rootDir: string): SnippetsCache {
  const cachePath = getCachePath(rootDir);

  if (!fs.existsSync(cachePath)) {
    return createEmptyCache();
  }

  try {
    const data = fs.readFileSync(cachePath, "utf-8");
    const cache = JSON.parse(data) as SnippetsCache;

    if (cache.version !== CACHE_VERSION) {
      return createEmptyCache();
    }

    return cache;
  } catch {
    return createEmptyCache();
  }
}

/**
 * Save snippets cache
 */
export function saveSnippetsCache(rootDir: string, cache: SnippetsCache): void {
  ensureRagDir(rootDir);
  const cachePath = getCachePath(rootDir);
  cache.stats.lastUpdated = Date.now();
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * Create empty cache
 */
function createEmptyCache(): SnippetsCache {
  return {
    version: CACHE_VERSION,
    snippets: [],
    stats: {
      totalSnippets: 0,
      totalInsertions: 0,
      lastUpdated: Date.now(),
    },
  };
}

/**
 * Add a new snippet
 */
export function addSnippet(
  cache: SnippetsCache,
  name: string,
  description: string,
  code: string,
  options?: {
    category?: SnippetCategory;
    language?: string;
    tags?: string[];
    sourceFile?: string;
  }
): CodeSnippet {
  const normalizedCode = normalizeCode(code);
  const id = generateSnippetId(name, code);

  // Check if exists
  const existingIndex = cache.snippets.findIndex((s) => s.id === id);
  if (existingIndex !== -1) {
    // Update existing
    const existing = cache.snippets[existingIndex];
    existing.code = code;
    existing.description = description;
    existing.metadata.updatedAt = Date.now();
    return existing;
  }

  const language = options?.language || detectLanguage(code);
  const category = options?.category || detectCategory(code, name);
  const variables = extractVariables(code);

  const snippet: CodeSnippet = {
    id,
    name,
    description,
    language,
    code,
    normalizedCode,
    category,
    usage: {
      useCount: 0,
      lastUsed: Date.now(),
      insertedIn: [],
    },
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: options?.tags || [],
      variables,
      sourceFile: options?.sourceFile,
    },
  };

  cache.snippets.push(snippet);
  cache.stats.totalSnippets++;

  // Enforce max size
  if (cache.snippets.length > MAX_SNIPPETS) {
    evictOldSnippets(cache);
  }

  return snippet;
}

/**
 * Find snippet by name or ID
 */
export function findSnippet(cache: SnippetsCache, nameOrId: string): CodeSnippet | null {
  return cache.snippets.find((s) =>
    s.id === nameOrId ||
    s.name.toLowerCase() === nameOrId.toLowerCase()
  ) || null;
}

/**
 * Search snippets by keyword
 */
export function searchSnippets(cache: SnippetsCache, query: string): CodeSnippet[] {
  const q = query.toLowerCase();
  return cache.snippets.filter((s) =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.code.toLowerCase().includes(q) ||
    s.metadata.tags.some((t) => t.toLowerCase().includes(q))
  ).sort((a, b) => b.usage.useCount - a.usage.useCount);
}

/**
 * Get snippets by category
 */
export function getByCategory(cache: SnippetsCache, category: SnippetCategory): CodeSnippet[] {
  return cache.snippets
    .filter((s) => s.category === category)
    .sort((a, b) => b.usage.useCount - a.usage.useCount);
}

/**
 * Get snippets by language
 */
export function getByLanguage(cache: SnippetsCache, language: string): CodeSnippet[] {
  return cache.snippets
    .filter((s) => s.language === language)
    .sort((a, b) => b.usage.useCount - a.usage.useCount);
}

/**
 * Get most used snippets
 */
export function getMostUsed(cache: SnippetsCache, count: number = 10): CodeSnippet[] {
  return [...cache.snippets]
    .sort((a, b) => b.usage.useCount - a.usage.useCount)
    .slice(0, count);
}

/**
 * Get recent snippets
 */
export function getRecentSnippets(cache: SnippetsCache, count: number = 10): CodeSnippet[] {
  return [...cache.snippets]
    .sort((a, b) => b.metadata.createdAt - a.metadata.createdAt)
    .slice(0, count);
}

/**
 * Record snippet usage
 */
export function recordUsage(snippet: CodeSnippet, insertedFile?: string): void {
  snippet.usage.useCount++;
  snippet.usage.lastUsed = Date.now();

  if (insertedFile && !snippet.usage.insertedIn.includes(insertedFile)) {
    snippet.usage.insertedIn.push(insertedFile);
    // Keep only last 20 files
    if (snippet.usage.insertedIn.length > 20) {
      snippet.usage.insertedIn = snippet.usage.insertedIn.slice(-20);
    }
  }
}

/**
 * Fill snippet variables with values
 */
export function fillSnippet(snippet: CodeSnippet, values: Record<string, string>): string {
  let code = snippet.code;

  for (const variable of snippet.metadata.variables) {
    const value = values[variable.name] || variable.defaultValue || variable.name;
    code = code.replace(new RegExp(`\\$\\{${variable.name}(?::[^}]*)?\\}`, "g"), value);
  }

  return code;
}

/**
 * Delete a snippet
 */
export function deleteSnippet(cache: SnippetsCache, id: string): boolean {
  const index = cache.snippets.findIndex((s) => s.id === id);
  if (index !== -1) {
    cache.snippets.splice(index, 1);
    cache.stats.totalSnippets--;
    return true;
  }
  return false;
}

/**
 * Evict old/unused snippets
 */
function evictOldSnippets(cache: SnippetsCache): void {
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  cache.snippets.sort((a, b) => {
    const scoreA = a.usage.useCount * Math.exp(-(now - a.usage.lastUsed) / thirtyDays);
    const scoreB = b.usage.useCount * Math.exp(-(now - b.usage.lastUsed) / thirtyDays);
    return scoreB - scoreA;
  });

  cache.snippets = cache.snippets.slice(0, MAX_SNIPPETS * 0.8);
  cache.stats.totalSnippets = cache.snippets.length;
}

/**
 * Format snippet for display
 */
export function formatSnippet(snippet: CodeSnippet): string {
  let output = `## ${snippet.name}\n\n`;
  output += `*${snippet.description}*\n\n`;
  output += `**Category:** ${snippet.category} | **Language:** ${snippet.language}\n`;
  output += `**Used:** ${snippet.usage.useCount}x | **Tags:** ${snippet.metadata.tags.join(", ") || "none"}\n\n`;

  output += "```" + snippet.language + "\n";
  output += snippet.code;
  output += "\n```\n";

  if (snippet.metadata.variables.length > 0) {
    output += "\n**Variables:**\n";
    for (const v of snippet.metadata.variables) {
      output += `- \`${v.name}\`: ${v.description}`;
      if (v.defaultValue) {
        output += ` (default: \`${v.defaultValue}\`)`;
      }
      output += "\n";
    }
  }

  return output;
}

/**
 * Format snippet list for display
 */
export function formatSnippetList(snippets: CodeSnippet[]): string {
  if (snippets.length === 0) {
    return "No snippets found.";
  }

  let output = `# Code Snippets (${snippets.length})\n\n`;

  // Group by category
  const byCategory: Record<string, CodeSnippet[]> = {};
  for (const snippet of snippets) {
    if (!byCategory[snippet.category]) {
      byCategory[snippet.category] = [];
    }
    byCategory[snippet.category].push(snippet);
  }

  for (const [category, categorySnippets] of Object.entries(byCategory)) {
    output += `## ${category.charAt(0).toUpperCase() + category.slice(1)} (${categorySnippets.length})\n\n`;

    for (const snippet of categorySnippets.slice(0, 5)) {
      output += `- **${snippet.name}** [${snippet.language}]: ${snippet.description.slice(0, 60)}...\n`;
      output += `  *${snippet.usage.useCount}x used*\n`;
    }

    if (categorySnippets.length > 5) {
      output += `  ... and ${categorySnippets.length - 5} more\n`;
    }
    output += "\n";
  }

  return output;
}

/**
 * Get cache statistics
 */
export function getCacheStats(cache: SnippetsCache): {
  totalSnippets: number;
  totalInsertions: number;
  byCategory: Record<string, number>;
  byLanguage: Record<string, number>;
  avgUseCount: number;
} {
  const byCategory: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  let totalUseCount = 0;

  for (const snippet of cache.snippets) {
    byCategory[snippet.category] = (byCategory[snippet.category] || 0) + 1;
    byLanguage[snippet.language] = (byLanguage[snippet.language] || 0) + 1;
    totalUseCount += snippet.usage.useCount;
  }

  return {
    totalSnippets: cache.stats.totalSnippets,
    totalInsertions: cache.stats.totalInsertions,
    byCategory,
    byLanguage,
    avgUseCount: cache.snippets.length > 0 ? totalUseCount / cache.snippets.length : 0,
  };
}

/**
 * Import snippets from a file
 */
export function importFromFile(
  cache: SnippetsCache,
  filePath: string,
  content: string
): CodeSnippet[] {
  const imported: CodeSnippet[] = [];
  const language = detectLanguage(content, filePath);

  // Extract named exports (functions, components, types)
  const patterns = [
    /export\s+(?:default\s+)?function\s+(\w+)[^{]*\{[\s\S]*?\n\}/g,
    /export\s+const\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)[^{]*\{[\s\S]*?\n\}/g,
    /export\s+(?:interface|type)\s+(\w+)[\s\S]*?(?=\nexport|\n\n|$)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const code = match[0];

      const snippet = addSnippet(cache, name, `Extracted from ${path.basename(filePath)}`, code, {
        language,
        sourceFile: filePath,
        tags: ["imported"],
      });

      imported.push(snippet);
    }
  }

  return imported;
}

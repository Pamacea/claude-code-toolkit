/**
 * Dependency Graph - Import/Export relationship navigation
 *
 * Builds a complete graph of imports and exports across the codebase.
 * Enables:
 * - Finding all files that import a given file
 * - Finding all files that a given file imports
 * - Detecting circular dependencies
 * - Finding dead code (unexported/unused)
 * - Tracing dependency chains
 */

import * as fs from "fs";
import * as path from "path";
import { type IndexedChunk, type VectorStore } from "./store.js";
import { getRagPath, ensureRagDir } from "./paths.js";

export interface DependencyNode {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  // Computed
  importedBy: string[];
  isEntryPoint: boolean;
  isLeaf: boolean;
}

export interface ImportInfo {
  source: string; // The import path
  resolvedPath: string | null; // Resolved to actual file
  names: string[]; // Named imports
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  type: "function" | "class" | "interface" | "type" | "const" | "default" | "re-export";
  line: number;
}

export interface DependencyGraph {
  version: string;
  createdAt: string;
  nodes: Map<string, DependencyNode>;
  // Quick lookups
  exportMap: Map<string, string[]>; // exportName -> filePaths
  circularDeps: string[][]; // Arrays of file paths forming cycles
  stats: GraphStats;
}

export interface GraphStats {
  totalFiles: number;
  totalImports: number;
  totalExports: number;
  entryPoints: number;
  leafNodes: number;
  circularDeps: number;
  avgImportsPerFile: number;
  avgExportsPerFile: number;
}

const GRAPH_VERSION = "1.0.0";

/**
 * Build dependency graph from vector store
 */
export function buildGraph(store: VectorStore, rootDir: string): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const exportMap = new Map<string, string[]>();

  // Group chunks by file
  const chunksByFile = new Map<string, IndexedChunk[]>();
  for (const chunk of store.chunks) {
    const existing = chunksByFile.get(chunk.filePath) || [];
    existing.push(chunk);
    chunksByFile.set(chunk.filePath, existing);
  }

  // Build nodes from chunks
  for (const [filePath, chunks] of chunksByFile) {
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    for (const chunk of chunks) {
      // Extract imports from dependencies
      if (chunk.dependencies) {
        for (const dep of chunk.dependencies) {
          const resolved = resolveImportPath(dep, filePath, rootDir);
          imports.push({
            source: dep,
            resolvedPath: resolved,
            names: [],
            isDefault: false,
            isNamespace: dep.includes("*"),
            line: chunk.startLine,
          });
        }
      }

      // Track exports
      if (chunk.exports && chunk.name) {
        const exportType = inferExportType(chunk.type);
        exports.push({
          name: chunk.name,
          type: exportType,
          line: chunk.startLine,
        });

        // Add to export map
        const existing = exportMap.get(chunk.name) || [];
        existing.push(filePath);
        exportMap.set(chunk.name, existing);
      }
    }

    nodes.set(filePath, {
      filePath,
      imports,
      exports,
      importedBy: [],
      isEntryPoint: false,
      isLeaf: false,
    });
  }

  // Compute reverse dependencies (importedBy)
  for (const [filePath, node] of nodes) {
    for (const imp of node.imports) {
      if (imp.resolvedPath && nodes.has(imp.resolvedPath)) {
        const targetNode = nodes.get(imp.resolvedPath)!;
        if (!targetNode.importedBy.includes(filePath)) {
          targetNode.importedBy.push(filePath);
        }
      }
    }
  }

  // Identify entry points (files with no importers)
  for (const node of nodes.values()) {
    node.isEntryPoint = node.importedBy.length === 0;
    node.isLeaf = node.imports.length === 0;
  }

  // Detect circular dependencies
  const circularDeps = detectCircularDependencies(nodes);

  // Compute stats
  let totalImports = 0;
  let totalExports = 0;
  let entryPoints = 0;
  let leafNodes = 0;

  for (const node of nodes.values()) {
    totalImports += node.imports.length;
    totalExports += node.exports.length;
    if (node.isEntryPoint) entryPoints++;
    if (node.isLeaf) leafNodes++;
  }

  const stats: GraphStats = {
    totalFiles: nodes.size,
    totalImports,
    totalExports,
    entryPoints,
    leafNodes,
    circularDeps: circularDeps.length,
    avgImportsPerFile: nodes.size > 0 ? totalImports / nodes.size : 0,
    avgExportsPerFile: nodes.size > 0 ? totalExports / nodes.size : 0,
  };

  return {
    version: GRAPH_VERSION,
    createdAt: new Date().toISOString(),
    nodes,
    exportMap,
    circularDeps,
    stats,
  };
}

/**
 * Resolve import path to actual file path
 */
function resolveImportPath(importPath: string, fromFile: string, rootDir: string): string | null {
  // Skip external modules
  if (!importPath.startsWith(".") && !importPath.startsWith("/") && !importPath.startsWith("@/")) {
    return null;
  }

  const fromDir = path.dirname(path.join(rootDir, fromFile));
  let resolved: string;

  if (importPath.startsWith("@/")) {
    // Alias resolution (common pattern)
    resolved = path.join(rootDir, "src", importPath.slice(2));
  } else {
    resolved = path.resolve(fromDir, importPath);
  }

  // Try common extensions
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

  for (const ext of extensions) {
    const fullPath = resolved + ext;
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

    // Check if we have this file in our nodes
    if (fs.existsSync(fullPath)) {
      return relativePath;
    }
  }

  return null;
}

/**
 * Infer export type from chunk type
 */
function inferExportType(chunkType: string): ExportInfo["type"] {
  if (chunkType.includes("function")) return "function";
  if (chunkType.includes("class")) return "class";
  if (chunkType.includes("interface")) return "interface";
  if (chunkType.includes("type")) return "type";
  if (chunkType.includes("const") || chunkType.includes("let") || chunkType.includes("var")) return "const";
  return "default";
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(nodes: Map<string, DependencyNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(filePath: string): void {
    if (recursionStack.has(filePath)) {
      // Found a cycle
      const cycleStart = path.indexOf(filePath);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        cycle.push(filePath);
        cycles.push(cycle);
      }
      return;
    }

    if (visited.has(filePath)) return;

    visited.add(filePath);
    recursionStack.add(filePath);
    path.push(filePath);

    const node = nodes.get(filePath);
    if (node) {
      for (const imp of node.imports) {
        if (imp.resolvedPath) {
          dfs(imp.resolvedPath);
        }
      }
    }

    path.pop();
    recursionStack.delete(filePath);
  }

  for (const filePath of nodes.keys()) {
    if (!visited.has(filePath)) {
      dfs(filePath);
    }
  }

  return cycles;
}

/**
 * Get all files that import a given file (direct and transitive)
 */
export function getImporters(graph: DependencyGraph, filePath: string, transitive: boolean = false): string[] {
  const node = graph.nodes.get(filePath);
  if (!node) return [];

  if (!transitive) {
    return [...node.importedBy];
  }

  // BFS for transitive importers
  const result = new Set<string>();
  const queue = [...node.importedBy];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (result.has(current)) continue;

    result.add(current);

    const currentNode = graph.nodes.get(current);
    if (currentNode) {
      for (const importer of currentNode.importedBy) {
        if (!result.has(importer)) {
          queue.push(importer);
        }
      }
    }
  }

  return [...result];
}

/**
 * Get all files that a given file imports (direct and transitive)
 */
export function getDependencies(graph: DependencyGraph, filePath: string, transitive: boolean = false): string[] {
  const node = graph.nodes.get(filePath);
  if (!node) return [];

  const directDeps = node.imports
    .map((i) => i.resolvedPath)
    .filter((p): p is string => p !== null);

  if (!transitive) {
    return directDeps;
  }

  // BFS for transitive dependencies
  const result = new Set<string>();
  const queue = [...directDeps];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (result.has(current)) continue;

    result.add(current);

    const currentNode = graph.nodes.get(current);
    if (currentNode) {
      for (const imp of currentNode.imports) {
        if (imp.resolvedPath && !result.has(imp.resolvedPath)) {
          queue.push(imp.resolvedPath);
        }
      }
    }
  }

  return [...result];
}

/**
 * Find files that export a given name
 */
export function findExport(graph: DependencyGraph, exportName: string): string[] {
  return graph.exportMap.get(exportName) || [];
}

/**
 * Find potentially dead code (exported but never imported)
 */
export function findDeadExports(graph: DependencyGraph): Array<{ filePath: string; export: string }> {
  const deadExports: Array<{ filePath: string; export: string }> = [];

  // Build set of all imported names
  const importedNames = new Set<string>();
  for (const node of graph.nodes.values()) {
    for (const imp of node.imports) {
      for (const name of imp.names) {
        importedNames.add(name);
      }
    }
  }

  // Check exports against imports
  for (const [exportName, files] of graph.exportMap) {
    // Skip common entry point exports
    if (["default", "index", "main"].includes(exportName)) continue;

    if (!importedNames.has(exportName)) {
      for (const filePath of files) {
        // Only flag if file is not an entry point
        const node = graph.nodes.get(filePath);
        if (node && !node.isEntryPoint) {
          deadExports.push({ filePath, export: exportName });
        }
      }
    }
  }

  return deadExports;
}

/**
 * Get dependency chain between two files
 */
export function getDependencyChain(
  graph: DependencyGraph,
  from: string,
  to: string
): string[] | null {
  const visited = new Set<string>();
  const queue: Array<{ path: string[] }> = [{ path: [from] }];

  while (queue.length > 0) {
    const { path: currentPath } = queue.shift()!;
    const current = currentPath[currentPath.length - 1];

    if (current === to) {
      return currentPath;
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const node = graph.nodes.get(current);
    if (node) {
      for (const imp of node.imports) {
        if (imp.resolvedPath && !visited.has(imp.resolvedPath)) {
          queue.push({ path: [...currentPath, imp.resolvedPath] });
        }
      }
    }
  }

  return null;
}

/**
 * Get impact analysis - what files would be affected by changing a file
 */
export function getImpactAnalysis(graph: DependencyGraph, filePath: string): {
  directImpact: string[];
  transitiveImpact: string[];
  impactScore: number;
} {
  const directImpact = getImporters(graph, filePath, false);
  const transitiveImpact = getImporters(graph, filePath, true);

  // Impact score: ratio of affected files to total files
  const impactScore = graph.stats.totalFiles > 0
    ? transitiveImpact.length / graph.stats.totalFiles
    : 0;

  return {
    directImpact,
    transitiveImpact,
    impactScore,
  };
}

/**
 * Save graph to disk
 */
export function saveGraph(rootDir: string, graph: DependencyGraph): void {
  ensureRagDir(rootDir);
  const graphPath = getRagPath(rootDir, "DEPS");

  // Convert Map to object for JSON serialization
  const serializable = {
    version: graph.version,
    createdAt: graph.createdAt,
    nodes: Object.fromEntries(graph.nodes),
    exportMap: Object.fromEntries(graph.exportMap),
    circularDeps: graph.circularDeps,
    stats: graph.stats,
  };

  fs.writeFileSync(graphPath, JSON.stringify(serializable, null, 2));
}

/**
 * Load graph from disk
 */
export function loadGraph(rootDir: string): DependencyGraph | null {
  const graphPath = getRagPath(rootDir, "DEPS");

  if (!fs.existsSync(graphPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(graphPath, "utf-8");
    const parsed = JSON.parse(data);

    if (parsed.version !== GRAPH_VERSION) {
      return null;
    }

    return {
      version: parsed.version,
      createdAt: parsed.createdAt,
      nodes: new Map(Object.entries(parsed.nodes)),
      exportMap: new Map(Object.entries(parsed.exportMap)),
      circularDeps: parsed.circularDeps,
      stats: parsed.stats,
    };
  } catch {
    return null;
  }
}

/**
 * Format graph for CLI output
 */
export function formatGraphStats(graph: DependencyGraph): string {
  let output = "\n📊 Dependency Graph Statistics\n\n";

  output += `Files indexed: ${graph.stats.totalFiles}\n`;
  output += `Total imports: ${graph.stats.totalImports}\n`;
  output += `Total exports: ${graph.stats.totalExports}\n`;
  output += `Avg imports/file: ${graph.stats.avgImportsPerFile.toFixed(1)}\n`;
  output += `Avg exports/file: ${graph.stats.avgExportsPerFile.toFixed(1)}\n`;
  output += `Entry points: ${graph.stats.entryPoints}\n`;
  output += `Leaf nodes: ${graph.stats.leafNodes}\n`;

  if (graph.circularDeps.length > 0) {
    output += `\n⚠️ Circular dependencies: ${graph.circularDeps.length}\n`;
    for (const cycle of graph.circularDeps.slice(0, 5)) {
      output += `   ${cycle.join(" → ")}\n`;
    }
    if (graph.circularDeps.length > 5) {
      output += `   ... and ${graph.circularDeps.length - 5} more\n`;
    }
  }

  return output;
}

/**
 * Format file dependencies for CLI output
 */
export function formatFileDependencies(
  graph: DependencyGraph,
  filePath: string,
  options: { transitive?: boolean; showImporters?: boolean } = {}
): string {
  const node = graph.nodes.get(filePath);
  if (!node) {
    return `File not found in graph: ${filePath}`;
  }

  let output = `\n📁 ${filePath}\n\n`;

  // Imports
  const deps = getDependencies(graph, filePath, options.transitive);
  output += `📥 Imports (${deps.length}):\n`;
  for (const dep of deps.slice(0, 20)) {
    output += `   ${dep}\n`;
  }
  if (deps.length > 20) {
    output += `   ... and ${deps.length - 20} more\n`;
  }

  // Importers
  if (options.showImporters) {
    const importers = getImporters(graph, filePath, options.transitive);
    output += `\n📤 Imported by (${importers.length}):\n`;
    for (const imp of importers.slice(0, 20)) {
      output += `   ${imp}\n`;
    }
    if (importers.length > 20) {
      output += `   ... and ${importers.length - 20} more\n`;
    }
  }

  // Exports
  output += `\n📦 Exports (${node.exports.length}):\n`;
  for (const exp of node.exports) {
    output += `   ${exp.name} (${exp.type})\n`;
  }

  return output;
}

/**
 * Format impact analysis for CLI output
 */
export function formatImpactAnalysis(
  graph: DependencyGraph,
  filePath: string
): string {
  const impact = getImpactAnalysis(graph, filePath);

  let output = `\n⚡ Impact Analysis: ${filePath}\n\n`;
  output += `Impact Score: ${(impact.impactScore * 100).toFixed(1)}%\n`;
  output += `Direct impact: ${impact.directImpact.length} files\n`;
  output += `Transitive impact: ${impact.transitiveImpact.length} files\n`;

  if (impact.directImpact.length > 0) {
    output += `\nDirectly affected:\n`;
    for (const file of impact.directImpact.slice(0, 10)) {
      output += `   ${file}\n`;
    }
    if (impact.directImpact.length > 10) {
      output += `   ... and ${impact.directImpact.length - 10} more\n`;
    }
  }

  return output;
}

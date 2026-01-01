import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface ProjectMemory {
  version: string;
  generatedAt: string;
  project: ProjectInfo;
  architecture: ArchitectureInfo;
  conventions: CodingConventions;
  constraints: string[];
  recentActivity: RecentActivity;
}

export interface ProjectInfo {
  name: string;
  description: string;
  type: "monorepo" | "single-package" | "unknown";
  packages: PackageInfo[];
  mainTechnologies: string[];
}

export interface PackageInfo {
  name: string;
  path: string;
  description?: string;
  dependencies: string[];
}

export interface ArchitectureInfo {
  structure: string[];
  entryPoints: string[];
  keyFiles: string[];
}

export interface CodingConventions {
  language: string;
  style: {
    quotes: "single" | "double" | "mixed";
    semicolons: boolean;
    indentation: "tabs" | "spaces";
    indentSize?: number;
  };
  patterns: string[];
  imports: "esm" | "commonjs" | "mixed";
}

export interface RecentActivity {
  lastCommit: string;
  recentFiles: string[];
  activeBranch: string;
}

const MEMORY_FILE = ".claude-memory.json";
const MEMORY_VERSION = "1.0.0";

/**
 * Get memory file path
 */
export function getMemoryPath(rootDir: string): string {
  return path.join(rootDir, MEMORY_FILE);
}

/**
 * Load existing memory
 */
export function loadMemory(rootDir: string): ProjectMemory | null {
  const memoryPath = getMemoryPath(rootDir);

  if (!fs.existsSync(memoryPath)) {
    return null;
  }

  try {
    const data = fs.readFileSync(memoryPath, "utf-8");
    return JSON.parse(data) as ProjectMemory;
  } catch {
    return null;
  }
}

/**
 * Save memory to disk
 */
export function saveMemory(rootDir: string, memory: ProjectMemory): void {
  const memoryPath = getMemoryPath(rootDir);
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
}

/**
 * Generate project memory from codebase analysis
 */
export function generateMemory(rootDir: string): ProjectMemory {
  const project = analyzeProject(rootDir);
  const architecture = analyzeArchitecture(rootDir);
  const conventions = detectConventions(rootDir);
  const constraints = detectConstraints(rootDir);
  const recentActivity = getRecentActivity(rootDir);

  return {
    version: MEMORY_VERSION,
    generatedAt: new Date().toISOString(),
    project,
    architecture,
    conventions,
    constraints,
    recentActivity,
  };
}

/**
 * Analyze project info from package.json files
 */
function analyzeProject(rootDir: string): ProjectInfo {
  const rootPkg = readPackageJson(rootDir);
  const packages: PackageInfo[] = [];
  let type: ProjectInfo["type"] = "single-package";

  // Check for monorepo
  const workspaces = rootPkg?.workspaces;
  const pnpmWorkspace = fs.existsSync(path.join(rootDir, "pnpm-workspace.yaml"));

  if (workspaces || pnpmWorkspace) {
    type = "monorepo";

    // Find packages
    const packagesDir = path.join(rootDir, "packages");
    if (fs.existsSync(packagesDir)) {
      const dirs = fs.readdirSync(packagesDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory()) {
          const pkgPath = path.join(packagesDir, dir.name);
          const pkg = readPackageJson(pkgPath);
          if (pkg) {
            packages.push({
              name: pkg.name || dir.name,
              path: `packages/${dir.name}`,
              description: pkg.description,
              dependencies: Object.keys(pkg.dependencies || {}),
            });
          }
        }
      }
    }
  }

  // Detect main technologies
  const mainTechnologies = detectTechnologies(rootDir, rootPkg);

  return {
    name: rootPkg?.name || path.basename(rootDir),
    description: rootPkg?.description || "",
    type,
    packages,
    mainTechnologies,
  };
}

/**
 * Analyze project architecture
 */
function analyzeArchitecture(rootDir: string): ArchitectureInfo {
  const structure: string[] = [];
  const entryPoints: string[] = [];
  const keyFiles: string[] = [];

  // Scan top-level structure
  const topLevel = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const item of topLevel) {
    if (item.name.startsWith(".") || item.name === "node_modules") continue;

    if (item.isDirectory()) {
      structure.push(`${item.name}/`);
    }
  }

  // Find entry points
  const commonEntries = [
    "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx",
    "src/App.tsx", "src/app.ts", "index.ts", "index.js",
  ];

  for (const entry of commonEntries) {
    if (fs.existsSync(path.join(rootDir, entry))) {
      entryPoints.push(entry);
    }
  }

  // Find key files
  const keyFilePatterns = [
    "CLAUDE.md", "README.md", "package.json",
    "tsconfig.json", "vite.config.ts", "next.config.js",
    ".eslintrc.js", "eslint.config.js",
  ];

  for (const pattern of keyFilePatterns) {
    if (fs.existsSync(path.join(rootDir, pattern))) {
      keyFiles.push(pattern);
    }
  }

  return { structure, entryPoints, keyFiles };
}

/**
 * Detect coding conventions from codebase
 */
function detectConventions(rootDir: string): CodingConventions {
  let language = "javascript";
  let quotes: CodingConventions["style"]["quotes"] = "double";
  let semicolons = true;
  let indentation: CodingConventions["style"]["indentation"] = "spaces";
  let indentSize = 2;
  let imports: CodingConventions["imports"] = "esm";
  const patterns: string[] = [];

  // Check for TypeScript (multiple locations)
  const tsConfigPaths = [
    path.join(rootDir, "tsconfig.json"),
    path.join(rootDir, "tsconfig.base.json"),
    path.join(rootDir, "packages", "core", "tsconfig.json"),
  ];

  if (tsConfigPaths.some(p => fs.existsSync(p))) {
    language = "typescript";
  }

  // Check package.json for type and deps first
  const pkg = readPackageJson(rootDir);

  // Also check dependencies for TypeScript
  if (pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript) {
    language = "typescript";
  }

  // Check ESLint config for style rules
  const eslintConfig = findEslintConfig(rootDir);
  if (eslintConfig) {
    // Parse basic rules if possible
    if (eslintConfig.includes("'single'") || eslintConfig.includes('"single"')) {
      quotes = "single";
    }
    if (eslintConfig.includes("semi") && eslintConfig.includes("never")) {
      semicolons = false;
    }
  }

  // Check Prettier config
  const prettierConfig = findPrettierConfig(rootDir);
  if (prettierConfig) {
    try {
      const config = JSON.parse(prettierConfig);
      if (config.singleQuote) quotes = "single";
      if (config.semi === false) semicolons = false;
      if (config.useTabs) indentation = "tabs";
      if (config.tabWidth) indentSize = config.tabWidth;
    } catch {}
  }

  // Check package.json for type (pkg already loaded above)
  if (pkg?.type === "module") {
    imports = "esm";
  } else if (pkg?.type === "commonjs") {
    imports = "commonjs";
  }

  // Detect patterns from CLAUDE.md or README
  const claudeMd = readFileIfExists(path.join(rootDir, "CLAUDE.md"));
  if (claudeMd) {
    // Extract patterns mentioned
    if (claudeMd.includes("kebab-case")) patterns.push("File names: kebab-case");
    if (claudeMd.includes("PascalCase")) patterns.push("Components: PascalCase");
    if (claudeMd.includes("strict")) patterns.push("TypeScript strict mode");
  }

  return {
    language,
    style: { quotes, semicolons, indentation, indentSize },
    patterns,
    imports,
  };
}

/**
 * Detect project constraints
 */
function detectConstraints(rootDir: string): string[] {
  const constraints: string[] = [];
  const pkg = readPackageJson(rootDir);

  // Node version
  if (pkg?.engines?.node) {
    constraints.push(`Node.js ${pkg.engines.node}`);
  }

  // Package manager
  if (pkg?.packageManager) {
    constraints.push(`Package manager: ${pkg.packageManager}`);
  } else if (fs.existsSync(path.join(rootDir, "pnpm-lock.yaml"))) {
    constraints.push("Package manager: pnpm");
  } else if (fs.existsSync(path.join(rootDir, "yarn.lock"))) {
    constraints.push("Package manager: yarn");
  }

  // Check CLAUDE.md for explicit constraints
  const claudeMd = readFileIfExists(path.join(rootDir, "CLAUDE.md"));
  if (claudeMd) {
    // Look for constraint patterns
    const lines = claudeMd.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes("never") || line.toLowerCase().includes("always")) {
        const trimmed = line.replace(/^[\s\-\*#]+/, "").trim();
        if (trimmed.length > 10 && trimmed.length < 100) {
          constraints.push(trimmed);
        }
      }
    }
  }

  return constraints.slice(0, 10); // Limit to 10 constraints
}

/**
 * Get recent activity info
 */
function getRecentActivity(rootDir: string): RecentActivity {
  let lastCommit = "";
  let activeBranch = "unknown";
  const recentFiles: string[] = [];

  try {
    // Get last commit message
    lastCommit = execSync("git log -1 --pretty=%B", {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim().split("\n")[0];

    // Get active branch
    activeBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();

    // Get recently modified files (cross-platform)
    try {
      const recentOutput = execSync("git log --oneline -5 --name-only --pretty=format:", {
        cwd: rootDir,
        encoding: "utf-8",
      });

      recentFiles.push(
        ...recentOutput.trim().split("\n").filter(Boolean).slice(0, 10)
      );
    } catch {
      // Fallback: get uncommitted changes
      const uncommitted = execSync("git diff --name-only", {
        cwd: rootDir,
        encoding: "utf-8",
      });
      recentFiles.push(...uncommitted.trim().split("\n").filter(Boolean));
    }
  } catch {
    // Git not available or not a git repo
  }

  return { lastCommit, recentFiles, activeBranch };
}

/**
 * Detect main technologies used
 */
function detectTechnologies(rootDir: string, pkg: any): string[] {
  const technologies: string[] = [];
  const allDeps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  };

  // Framework detection
  if (allDeps.react) technologies.push("React");
  if (allDeps.vue) technologies.push("Vue");
  if (allDeps.svelte) technologies.push("Svelte");
  if (allDeps["solid-js"]) technologies.push("SolidJS");
  if (allDeps.next) technologies.push("Next.js");
  if (allDeps.nuxt) technologies.push("Nuxt");
  if (allDeps.express) technologies.push("Express");
  if (allDeps.fastify) technologies.push("Fastify");

  // Build tools
  if (allDeps.vite) technologies.push("Vite");
  if (allDeps.webpack) technologies.push("Webpack");
  if (allDeps.esbuild) technologies.push("esbuild");
  if (allDeps.tsup) technologies.push("tsup");

  // Testing
  if (allDeps.jest) technologies.push("Jest");
  if (allDeps.vitest) technologies.push("Vitest");
  if (allDeps.playwright) technologies.push("Playwright");

  // TypeScript
  if (allDeps.typescript) technologies.push("TypeScript");

  // Styling
  if (allDeps.tailwindcss) technologies.push("Tailwind CSS");

  return technologies;
}

/**
 * Format memory as compact context for Claude
 */
export function formatMemoryContext(memory: ProjectMemory): string {
  let output = `<project-memory generated="${memory.generatedAt}">\n\n`;

  // Project info
  output += `<project name="${memory.project.name}" type="${memory.project.type}">\n`;
  output += `${memory.project.description}\n`;
  if (memory.project.mainTechnologies.length > 0) {
    output += `Stack: ${memory.project.mainTechnologies.join(", ")}\n`;
  }
  output += `</project>\n\n`;

  // Packages (for monorepos)
  if (memory.project.packages.length > 0) {
    output += `<packages>\n`;
    for (const pkg of memory.project.packages) {
      output += `- ${pkg.name} (${pkg.path})${pkg.description ? `: ${pkg.description}` : ""}\n`;
    }
    output += `</packages>\n\n`;
  }

  // Architecture
  output += `<architecture>\n`;
  output += `Structure: ${memory.architecture.structure.join(", ")}\n`;
  if (memory.architecture.entryPoints.length > 0) {
    output += `Entry points: ${memory.architecture.entryPoints.join(", ")}\n`;
  }
  output += `</architecture>\n\n`;

  // Conventions
  output += `<conventions>\n`;
  output += `Language: ${memory.conventions.language}\n`;
  output += `Style: ${memory.conventions.style.quotes} quotes, ${memory.conventions.style.semicolons ? "semicolons" : "no semicolons"}, ${memory.conventions.style.indentation}\n`;
  output += `Imports: ${memory.conventions.imports}\n`;
  if (memory.conventions.patterns.length > 0) {
    output += `Patterns: ${memory.conventions.patterns.join("; ")}\n`;
  }
  output += `</conventions>\n\n`;

  // Constraints
  if (memory.constraints.length > 0) {
    output += `<constraints>\n`;
    for (const constraint of memory.constraints) {
      output += `- ${constraint}\n`;
    }
    output += `</constraints>\n\n`;
  }

  // Recent activity
  output += `<recent-activity branch="${memory.recentActivity.activeBranch}">\n`;
  if (memory.recentActivity.lastCommit) {
    output += `Last commit: ${memory.recentActivity.lastCommit}\n`;
  }
  if (memory.recentActivity.recentFiles.length > 0) {
    output += `Recent files: ${memory.recentActivity.recentFiles.slice(0, 5).join(", ")}\n`;
  }
  output += `</recent-activity>\n\n`;

  output += `</project-memory>`;
  return output;
}

/**
 * Check if memory needs refresh (older than 1 hour or key files changed)
 */
export function needsRefresh(rootDir: string, memory: ProjectMemory): boolean {
  const generatedAt = new Date(memory.generatedAt).getTime();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  if (generatedAt < oneHourAgo) {
    return true;
  }

  // Check if key files changed
  try {
    const changedFiles = execSync("git diff --name-only HEAD", {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim().split("\n").filter(Boolean);

    const keyFiles = ["package.json", "CLAUDE.md", "tsconfig.json"];
    return changedFiles.some(f => keyFiles.includes(f));
  } catch {
    return false;
  }
}

// Helper functions

function readPackageJson(dir: string): any {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

function readFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function findEslintConfig(rootDir: string): string | null {
  const configs = [
    ".eslintrc.js", ".eslintrc.json", ".eslintrc.yaml",
    "eslint.config.js", "eslint.config.mjs",
  ];

  for (const config of configs) {
    const content = readFileIfExists(path.join(rootDir, config));
    if (content) return content;
  }

  return null;
}

function findPrettierConfig(rootDir: string): string | null {
  const configs = [
    ".prettierrc", ".prettierrc.json", ".prettierrc.js",
    "prettier.config.js",
  ];

  for (const config of configs) {
    const content = readFileIfExists(path.join(rootDir, config));
    if (content) return content;
  }

  // Check package.json
  const pkg = readPackageJson(rootDir);
  if (pkg?.prettier) {
    return JSON.stringify(pkg.prettier);
  }

  return null;
}

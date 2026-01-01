import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const DEFAULT_PATTERNS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.json",
  "**/*.md",
  "**/*.css",
];

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.map",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/.rag-index.json",
];

export interface ScanOptions {
  patterns?: string[];
  ignore?: string[];
  maxFileSize?: number;
}

export interface ScannedFile {
  path: string;
  relativePath: string;
  content: string;
  size: number;
}

export async function scanDirectory(
  rootDir: string,
  options: ScanOptions = {}
): Promise<ScannedFile[]> {
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const maxFileSize = options.maxFileSize ?? 100 * 1024;

  const files: ScannedFile[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: rootDir,
      ignore,
      nodir: true,
      absolute: false,
    });

    for (const relativePath of matches) {
      const absolutePath = path.join(rootDir, relativePath);

      try {
        const stats = fs.statSync(absolutePath);
        if (stats.size > maxFileSize) {
          continue;
        }

        const content = fs.readFileSync(absolutePath, "utf-8");

        if (content.includes("\0")) {
          continue;
        }

        files.push({
          path: absolutePath,
          relativePath,
          content,
          size: stats.size,
        });
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return files;
}

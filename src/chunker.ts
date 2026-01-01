import { chunkTypeScriptAST, type ASTChunk } from "./ast-chunker.js";

export interface Chunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  type: "function" | "class" | "interface" | "type" | "component" | "variable" | "import-block" | "file" | "block";
  name?: string;
  signature?: string;
  dependencies?: string[];
  exports?: boolean;
}

const MAX_CHUNK_SIZE = 1500;
const OVERLAP = 200;

export interface ChunkOptions {
  useAST?: boolean; // Use AST-based chunking for TS/JS (default: true)
}

export function chunkFile(filePath: string, content: string, options: ChunkOptions = {}): Chunk[] {
  const { useAST = true } = options;
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const lines = content.split("\n");

  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    if (useAST) {
      try {
        const astChunks = chunkTypeScriptAST(filePath, content);
        // Convert ASTChunk to Chunk (compatible)
        return astChunks as Chunk[];
      } catch {
        // Fallback to regex-based chunking on AST errors
        return chunkTypeScript(filePath, content, lines);
      }
    }
    return chunkTypeScript(filePath, content, lines);
  }

  if (ext === "md") {
    return chunkMarkdown(filePath, content, lines);
  }

  return chunkGeneric(filePath, content, lines);
}

function chunkTypeScript(filePath: string, content: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const patterns = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, type: "function" as const },
    { regex: /^(?:export\s+)?class\s+(\w+)/m, type: "class" as const },
    { regex: /^(?:export\s+)?interface\s+(\w+)/m, type: "interface" as const },
    { regex: /^(?:export\s+)?type\s+(\w+)/m, type: "type" as const },
    { regex: /^(?:export\s+)?const\s+(\w+):\s*(?:React\.)?(?:FC|Component)/m, type: "component" as const },
    { regex: /^const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::\s*\w+)?\s*=>/m, type: "function" as const },
  ];

  let currentChunk: { start: number; end: number; content: string[]; name?: string; type: Chunk["type"] } | null = null;
  let braceCount = 0;
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock) {
      for (const { regex, type } of patterns) {
        const match = line.match(regex);
        if (match) {
          if (currentChunk && currentChunk.content.length > 0) {
            chunks.push(createChunk(filePath, currentChunk, chunks.length));
          }
          currentChunk = { start: i, end: i, content: [line], name: match[1], type };
          inBlock = true;
          braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
          break;
        }
      }
    } else if (currentChunk) {
      currentChunk.content.push(line);
      currentChunk.end = i;
      braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      if (braceCount <= 0 && line.includes("}")) {
        chunks.push(createChunk(filePath, currentChunk, chunks.length));
        currentChunk = null;
        inBlock = false;
        braceCount = 0;
      }
    }
  }

  if (currentChunk && currentChunk.content.length > 0) {
    chunks.push(createChunk(filePath, currentChunk, chunks.length));
  }

  if (chunks.length === 0) {
    return chunkGeneric(filePath, content, lines);
  }

  return chunks;
}

function chunkMarkdown(filePath: string, content: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  // Special handling for key project files
  const isProgressFile = fileName === "PROGRESS.md";
  const isNextSteps = fileName === "NEXT_STEPS.md";

  // Find all headers and their content
  const sections: Array<{ title: string; level: number; startLine: number; content: string[] }> = [];
  let currentSection: { title: string; level: number; startLine: number; content: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);

    if (headerMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: headerMatch[2],
        level: headerMatch[1].length,
        startLine: i,
        content: [line],
      };
    } else if (currentSection) {
      currentSection.content.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  // For PROGRESS.md and NEXT_STEPS.md, create special chunks for important sections
  for (const section of sections) {
    const sectionContent = section.content.join("\n").trim();
    if (!sectionContent) continue;

    // Skip empty or too small sections
    if (sectionContent.length < 20) continue;

    // Create semantic type based on section title
    let sectionType = "section";
    const titleLower = section.title.toLowerCase();

    if (titleLower.includes("état actuel") || titleLower.includes("current state")) {
      sectionType = "current-state";
    } else if (titleLower.includes("prochaine") || titleLower.includes("next")) {
      sectionType = "next-steps";
    } else if (titleLower.includes("todo") || titleLower.includes("à faire")) {
      sectionType = "todo";
    } else if (titleLower.includes("bug") || titleLower.includes("fix")) {
      sectionType = "bugfix";
    } else if (titleLower.includes("priorit")) {
      sectionType = "priority";
    }

    // For large sections, split them
    if (sectionContent.length > MAX_CHUNK_SIZE) {
      const subChunks = splitLargeSection(filePath, section, chunks.length);
      chunks.push(...subChunks);
    } else {
      chunks.push({
        id: `${filePath}:${chunks.length}`,
        filePath,
        content: sectionContent,
        startLine: section.startLine,
        endLine: section.startLine + section.content.length - 1,
        type: "block",
        name: `${sectionType}:${section.title}`,
      });
    }
  }

  // If no sections found, fall back to generic chunking
  if (chunks.length === 0) {
    return chunkGeneric(filePath, content, lines);
  }

  return chunks;
}

function splitLargeSection(
  filePath: string,
  section: { title: string; startLine: number; content: string[] },
  startIndex: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let currentContent: string[] = [];
  let currentStart = section.startLine;
  let chunkIndex = startIndex;

  for (let i = 0; i < section.content.length; i++) {
    const line = section.content[i];
    currentContent.push(line);

    if (currentContent.join("\n").length >= MAX_CHUNK_SIZE) {
      chunks.push({
        id: `${filePath}:${chunkIndex++}`,
        filePath,
        content: currentContent.join("\n"),
        startLine: currentStart,
        endLine: section.startLine + i,
        type: "block",
        name: section.title,
      });
      currentStart = section.startLine + i + 1;
      currentContent = [];
    }
  }

  if (currentContent.length > 0) {
    chunks.push({
      id: `${filePath}:${chunkIndex}`,
      filePath,
      content: currentContent.join("\n"),
      startLine: currentStart,
      endLine: section.startLine + section.content.length - 1,
      type: "block",
      name: section.title,
    });
  }

  return chunks;
}

function chunkGeneric(filePath: string, content: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];

  if (content.length <= MAX_CHUNK_SIZE) {
    chunks.push({
      id: `${filePath}:0`,
      filePath,
      content,
      startLine: 0,
      endLine: lines.length - 1,
      type: "file",
    });
    return chunks;
  }

  let start = 0;
  while (start < lines.length) {
    let end = start;
    let currentSize = 0;

    while (end < lines.length && currentSize < MAX_CHUNK_SIZE) {
      currentSize += lines[end].length + 1;
      end++;
    }

    const chunkContent = lines.slice(start, end).join("\n");
    chunks.push({
      id: `${filePath}:${chunks.length}`,
      filePath,
      content: chunkContent,
      startLine: start,
      endLine: end - 1,
      type: "block",
    });

    start = Math.max(start + 1, end - Math.floor(OVERLAP / 50));
  }

  return chunks;
}

function createChunk(
  filePath: string,
  chunk: { start: number; end: number; content: string[]; name?: string; type: Chunk["type"] },
  index: number
): Chunk {
  return {
    id: `${filePath}:${index}`,
    filePath,
    content: chunk.content.join("\n"),
    startLine: chunk.start,
    endLine: chunk.end,
    type: chunk.type,
    name: chunk.name,
  };
}

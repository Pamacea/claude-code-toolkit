import { Project, Node, SyntaxKind, SourceFile } from "ts-morph";
import * as path from "path";

export interface ASTChunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  type: "function" | "class" | "interface" | "type" | "component" | "variable" | "import-block" | "file";
  name?: string;
  signature?: string;
  dependencies?: string[];
  exports?: boolean;
}

interface ExtractedNode {
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  type: ASTChunk["type"];
  signature?: string;
  dependencies: string[];
  isExported: boolean;
}

const MAX_CHUNK_SIZE = 2000;

// Shared project instance for performance
let project: Project | null = null;

function getProject(): Project {
  if (!project) {
    project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 2, // React
      },
      useInMemoryFileSystem: true,
    });
  }
  return project;
}

export function chunkTypeScriptAST(filePath: string, content: string): ASTChunk[] {
  const chunks: ASTChunk[] = [];
  const proj = getProject();

  // Create virtual source file
  const normalizedPath = filePath.replace(/\\/g, "/");
  const sourceFile = proj.createSourceFile(normalizedPath, content, { overwrite: true });

  try {
    const extracted = extractNodes(sourceFile);

    // Group imports into single chunk
    const importStatements = sourceFile.getImportDeclarations();
    if (importStatements.length > 0) {
      const firstImport = importStatements[0];
      const lastImport = importStatements[importStatements.length - 1];
      const importContent = importStatements.map(i => i.getText()).join("\n");

      if (importContent.length > 50) {
        chunks.push({
          id: `${filePath}:imports`,
          filePath,
          content: importContent,
          startLine: firstImport.getStartLineNumber(),
          endLine: lastImport.getEndLineNumber(),
          type: "import-block",
          name: "imports",
        });
      }
    }

    // Add extracted nodes as chunks
    for (const node of extracted) {
      // Split large chunks
      if (node.content.length > MAX_CHUNK_SIZE) {
        const subChunks = splitLargeNode(filePath, node, chunks.length);
        chunks.push(...subChunks);
      } else {
        chunks.push({
          id: `${filePath}:${chunks.length}`,
          filePath,
          content: node.content,
          startLine: node.startLine,
          endLine: node.endLine,
          type: node.type,
          name: node.name,
          signature: node.signature,
          dependencies: node.dependencies.length > 0 ? node.dependencies : undefined,
          exports: node.isExported || undefined,
        });
      }
    }

    // If no meaningful chunks, fallback to file chunk
    if (chunks.length === 0 || (chunks.length === 1 && chunks[0].type === "import-block")) {
      chunks.push({
        id: `${filePath}:file`,
        filePath,
        content: content.slice(0, MAX_CHUNK_SIZE),
        startLine: 1,
        endLine: content.split("\n").length,
        type: "file",
      });
    }

  } finally {
    // Clean up virtual file
    proj.removeSourceFile(sourceFile);
  }

  return chunks;
}

function extractNodes(sourceFile: SourceFile): ExtractedNode[] {
  const nodes: ExtractedNode[] = [];

  // Extract functions (including arrow functions assigned to const)
  for (const func of sourceFile.getFunctions()) {
    nodes.push(extractFunction(func));
  }

  // Extract arrow functions assigned to variables
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const initializer = varDecl.getInitializer();
    if (initializer && Node.isArrowFunction(initializer)) {
      const name = varDecl.getName();
      const varStmt = varDecl.getVariableStatement();
      const isExported = varStmt?.isExported() ?? false;

      // Check if it's a React component
      const isComponent = isReactComponent(name, initializer.getText());

      nodes.push({
        name,
        content: varStmt?.getText() ?? varDecl.getText(),
        startLine: (varStmt ?? varDecl).getStartLineNumber(),
        endLine: (varStmt ?? varDecl).getEndLineNumber(),
        type: isComponent ? "component" : "function",
        signature: extractArrowSignature(varDecl),
        dependencies: extractDependencies(initializer),
        isExported,
      });
    }
  }

  // Extract classes
  for (const cls of sourceFile.getClasses()) {
    nodes.push(extractClass(cls));
  }

  // Extract interfaces
  for (const iface of sourceFile.getInterfaces()) {
    nodes.push({
      name: iface.getName(),
      content: iface.getText(),
      startLine: iface.getStartLineNumber(),
      endLine: iface.getEndLineNumber(),
      type: "interface",
      signature: `interface ${iface.getName()}`,
      dependencies: extractInterfaceDependencies(iface),
      isExported: iface.isExported(),
    });
  }

  // Extract type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    nodes.push({
      name: typeAlias.getName(),
      content: typeAlias.getText(),
      startLine: typeAlias.getStartLineNumber(),
      endLine: typeAlias.getEndLineNumber(),
      type: "type",
      signature: `type ${typeAlias.getName()}`,
      dependencies: [],
      isExported: typeAlias.isExported(),
    });
  }

  // Extract exported constants/variables (non-function)
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const initializer = varDecl.getInitializer();
    const varStmt = varDecl.getVariableStatement();
    const isExported = varStmt?.isExported() ?? false;

    // Skip arrow functions (already handled)
    if (initializer && Node.isArrowFunction(initializer)) continue;

    // Only include exported or significant variables
    if (isExported || varDecl.getText().length > 100) {
      const existing = nodes.find(n => n.name === varDecl.getName());
      if (!existing) {
        nodes.push({
          name: varDecl.getName(),
          content: varStmt?.getText() ?? varDecl.getText(),
          startLine: (varStmt ?? varDecl).getStartLineNumber(),
          endLine: (varStmt ?? varDecl).getEndLineNumber(),
          type: "variable",
          dependencies: [],
          isExported,
        });
      }
    }
  }

  // Sort by line number
  nodes.sort((a, b) => a.startLine - b.startLine);

  return nodes;
}

function extractFunction(func: Node): ExtractedNode {
  const name = (func as any).getName?.() ?? "anonymous";
  const isExported = (func as any).isExported?.() ?? false;

  // Build signature
  let signature = "";
  if ((func as any).isAsync?.()) signature += "async ";
  signature += `function ${name}(`;

  const params = (func as any).getParameters?.() ?? [];
  signature += params.map((p: any) => {
    const paramName = p.getName();
    const paramType = p.getType().getText();
    return `${paramName}: ${paramType}`;
  }).join(", ");

  signature += ")";

  const returnType = (func as any).getReturnType?.()?.getText();
  if (returnType && returnType !== "void") {
    signature += `: ${returnType}`;
  }

  return {
    name,
    content: func.getText(),
    startLine: func.getStartLineNumber(),
    endLine: func.getEndLineNumber(),
    type: "function",
    signature,
    dependencies: extractDependencies(func),
    isExported,
  };
}

function extractClass(cls: Node): ExtractedNode {
  const name = (cls as any).getName?.() ?? "AnonymousClass";
  const isExported = (cls as any).isExported?.() ?? false;

  // Build signature with methods
  let signature = `class ${name}`;
  const methods = (cls as any).getMethods?.() ?? [];
  if (methods.length > 0) {
    signature += ` { ${methods.map((m: any) => m.getName()).join(", ")} }`;
  }

  return {
    name,
    content: cls.getText(),
    startLine: cls.getStartLineNumber(),
    endLine: cls.getEndLineNumber(),
    type: "class",
    signature,
    dependencies: extractDependencies(cls),
    isExported,
  };
}

function extractArrowSignature(varDecl: any): string {
  const name = varDecl.getName();
  const initializer = varDecl.getInitializer();

  if (!initializer) return `const ${name}`;

  const params = initializer.getParameters?.() ?? [];
  const paramStr = params.map((p: any) => {
    const paramName = p.getName();
    const paramType = p.getType()?.getText() ?? "any";
    return `${paramName}: ${paramType}`;
  }).join(", ");

  return `const ${name} = (${paramStr}) =>`;
}

function extractDependencies(node: Node): string[] {
  const deps = new Set<string>();

  // Find all identifiers that are function calls or references
  node.forEachDescendant((descendant) => {
    if (Node.isCallExpression(descendant)) {
      const expr = descendant.getExpression();
      if (Node.isIdentifier(expr)) {
        deps.add(expr.getText());
      } else if (Node.isPropertyAccessExpression(expr)) {
        // Handle foo.bar() - get the root identifier
        const rootExpr = expr.getExpression();
        if (Node.isIdentifier(rootExpr)) {
          deps.add(rootExpr.getText());
        }
      }
    }
  });

  // Filter out common globals and built-ins
  const builtins = new Set([
    "console", "Math", "Date", "JSON", "Object", "Array", "String", "Number",
    "Boolean", "Promise", "Set", "Map", "Error", "RegExp", "parseInt", "parseFloat",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval", "fetch",
    "require", "module", "exports", "process", "Buffer", "__dirname", "__filename",
  ]);

  return Array.from(deps).filter(d => !builtins.has(d));
}

function extractInterfaceDependencies(iface: any): string[] {
  const deps = new Set<string>();

  // Get extended interfaces
  const extendedTypes = iface.getExtends?.() ?? [];
  for (const ext of extendedTypes) {
    deps.add(ext.getText().split("<")[0]); // Remove generics
  }

  return Array.from(deps);
}

function isReactComponent(name: string, content: string): boolean {
  // Check naming convention (PascalCase)
  if (!/^[A-Z]/.test(name)) return false;

  // Check for JSX or React patterns
  return (
    content.includes("JSX.Element") ||
    content.includes("React.") ||
    content.includes("useState") ||
    content.includes("useEffect") ||
    content.includes("<") && content.includes("/>")
  );
}

function splitLargeNode(filePath: string, node: ExtractedNode, startIndex: number): ASTChunk[] {
  const chunks: ASTChunk[] = [];
  const lines = node.content.split("\n");

  let currentLines: string[] = [];
  let currentStart = node.startLine;
  let chunkIndex = startIndex;

  for (let i = 0; i < lines.length; i++) {
    currentLines.push(lines[i]);

    if (currentLines.join("\n").length >= MAX_CHUNK_SIZE) {
      chunks.push({
        id: `${filePath}:${chunkIndex++}`,
        filePath,
        content: currentLines.join("\n"),
        startLine: currentStart,
        endLine: node.startLine + i,
        type: node.type,
        name: `${node.name}_part${chunks.length + 1}`,
        signature: chunks.length === 0 ? node.signature : undefined,
        dependencies: chunks.length === 0 ? node.dependencies : undefined,
        exports: chunks.length === 0 ? node.isExported : undefined,
      });
      currentStart = node.startLine + i + 1;
      currentLines = [];
    }
  }

  if (currentLines.length > 0) {
    chunks.push({
      id: `${filePath}:${chunkIndex}`,
      filePath,
      content: currentLines.join("\n"),
      startLine: currentStart,
      endLine: node.endLine,
      type: node.type,
      name: chunks.length > 0 ? `${node.name}_part${chunks.length + 1}` : node.name,
    });
  }

  return chunks;
}

// Stats for comparison
export function getASTStats(chunks: ASTChunk[]): {
  total: number;
  byType: Record<string, number>;
  withDeps: number;
  withSignatures: number;
  avgChunkSize: number;
} {
  const byType: Record<string, number> = {};
  let withDeps = 0;
  let withSignatures = 0;
  let totalSize = 0;

  for (const chunk of chunks) {
    byType[chunk.type] = (byType[chunk.type] || 0) + 1;
    if (chunk.dependencies?.length) withDeps++;
    if (chunk.signature) withSignatures++;
    totalSize += chunk.content.length;
  }

  return {
    total: chunks.length,
    byType,
    withDeps,
    withSignatures,
    avgChunkSize: Math.round(totalSize / chunks.length),
  };
}

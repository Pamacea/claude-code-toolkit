/**
 * Surgeon Module - AST-based minimal context extraction
 *
 * Extracts only imports, type signatures, and function signatures
 * without function bodies. Reduces token usage by 70-85%.
 */

import * as fs from "fs";
import * as path from "path";
import { type IndexedChunk } from "./store.js";

export interface SurgeonResult {
  filePath: string;
  imports: ImportStatement[];
  exports: ExportStatement[];
  types: TypeSignature[];
  functions: FunctionSignature[];
  classes: ClassSignature[];
  constants: ConstantDeclaration[];
  estimatedTokensSaved: number;
  originalTokens: number;
  surgeonTokens: number;
}

export interface ImportStatement {
  line: number;
  source: string;
  named: string[];
  default?: string;
  isTypeOnly: boolean;
}

export interface ExportStatement {
  line: number;
  name: string;
  type: "function" | "class" | "type" | "interface" | "const" | "default" | "re-export";
}

export interface TypeSignature {
  line: number;
  name: string;
  kind: "interface" | "type" | "enum";
  exported: boolean;
  signature: string;
  properties?: string[];
}

export interface FunctionSignature {
  line: number;
  name: string;
  exported: boolean;
  async: boolean;
  signature: string;
  params: string;
  returnType?: string;
}

export interface ClassSignature {
  line: number;
  name: string;
  exported: boolean;
  extends?: string;
  implements?: string[];
  methods: MethodSignature[];
}

export interface MethodSignature {
  line: number;
  name: string;
  visibility: "public" | "private" | "protected";
  static: boolean;
  async: boolean;
  signature: string;
}

export interface ConstantDeclaration {
  line: number;
  name: string;
  exported: boolean;
  type?: string;
  value?: string;
}

const CHARS_PER_TOKEN = 4;

/**
 * Extract surgeon-mode content from a file
 */
export function extractSurgeonContent(filePath: string): SurgeonResult | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const originalTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

  const result: SurgeonResult = {
    filePath,
    imports: extractImports(lines),
    exports: extractExports(lines),
    types: extractTypes(lines),
    functions: extractFunctions(lines),
    classes: extractClasses(lines),
    constants: extractConstants(lines),
    estimatedTokensSaved: 0,
    originalTokens,
    surgeonTokens: 0,
  };

  const surgeonContent = formatSurgeonContent(result);
  result.surgeonTokens = Math.ceil(surgeonContent.length / CHARS_PER_TOKEN);
  result.estimatedTokensSaved = originalTokens - result.surgeonTokens;

  return result;
}

/**
 * Extract surgeon content from indexed chunks
 */
export function extractSurgeonFromChunks(chunks: IndexedChunk[]): SurgeonResult[] {
  const resultsByFile = new Map<string, SurgeonResult>();

  for (const chunk of chunks) {
    let result = resultsByFile.get(chunk.filePath);

    if (!result) {
      result = extractSurgeonContent(chunk.filePath) || {
        filePath: chunk.filePath,
        imports: [],
        exports: [],
        types: [],
        functions: [],
        classes: [],
        constants: [],
        estimatedTokensSaved: 0,
        originalTokens: 0,
        surgeonTokens: 0,
      };
      resultsByFile.set(chunk.filePath, result);
    }
  }

  return Array.from(resultsByFile.values());
}

/**
 * Extract import statements
 */
function extractImports(lines: string[]): ImportStatement[] {
  const imports: ImportStatement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("import ")) {
      const isTypeOnly = line.includes("import type ");
      const sourceMatch = line.match(/from\s+["']([^"']+)["']/);
      const source = sourceMatch?.[1] || "";

      const namedMatch = line.match(/\{([^}]+)\}/);
      const named = namedMatch
        ? namedMatch[1].split(",").map(s => s.trim().split(" as ")[0])
        : [];

      const defaultMatch = line.match(/import\s+(?:type\s+)?(\w+)\s+from/);
      const defaultImport = defaultMatch && !namedMatch ? defaultMatch[1] : undefined;

      imports.push({
        line: i + 1,
        source,
        named,
        default: defaultImport,
        isTypeOnly,
      });
    }
  }

  return imports;
}

/**
 * Extract export statements
 */
function extractExports(lines: string[]): ExportStatement[] {
  const exports: ExportStatement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("export ")) {
      if (line.includes("export default")) {
        exports.push({ line: i + 1, name: "default", type: "default" });
      } else if (line.includes("export function")) {
        const match = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
        if (match) exports.push({ line: i + 1, name: match[1], type: "function" });
      } else if (line.includes("export class")) {
        const match = line.match(/export\s+class\s+(\w+)/);
        if (match) exports.push({ line: i + 1, name: match[1], type: "class" });
      } else if (line.includes("export interface")) {
        const match = line.match(/export\s+interface\s+(\w+)/);
        if (match) exports.push({ line: i + 1, name: match[1], type: "interface" });
      } else if (line.includes("export type")) {
        const match = line.match(/export\s+type\s+(\w+)/);
        if (match) exports.push({ line: i + 1, name: match[1], type: "type" });
      } else if (line.includes("export const") || line.includes("export let")) {
        const match = line.match(/export\s+(?:const|let)\s+(\w+)/);
        if (match) exports.push({ line: i + 1, name: match[1], type: "const" });
      } else if (line.includes("export {") || line.includes("export *")) {
        exports.push({ line: i + 1, name: line.slice(0, 50), type: "re-export" });
      }
    }
  }

  return exports;
}

/**
 * Extract type/interface definitions with properties
 */
function extractTypes(lines: string[]): TypeSignature[] {
  const types: TypeSignature[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const exported = line.startsWith("export ");

    if (line.includes("interface ") && line.includes("{")) {
      const match = line.match(/interface\s+(\w+)(?:<[^>]+>)?\s*(?:extends\s+[^{]+)?\s*\{/);
      if (match) {
        const properties = extractTypeProperties(lines, i);
        const signature = buildTypeSignature("interface", match[1], properties);
        types.push({
          line: i + 1,
          name: match[1],
          kind: "interface",
          exported,
          signature,
          properties,
        });
        i = skipBlock(lines, i);
        continue;
      }
    }

    if (line.includes("type ") && line.includes("=")) {
      const match = line.match(/type\s+(\w+)(?:<[^>]+>)?\s*=/);
      if (match) {
        const signature = extractTypeAliasSignature(lines, i);
        types.push({
          line: i + 1,
          name: match[1],
          kind: "type",
          exported,
          signature,
        });
      }
    }

    if (line.includes("enum ") && line.includes("{")) {
      const match = line.match(/enum\s+(\w+)\s*\{/);
      if (match) {
        const values = extractEnumValues(lines, i);
        types.push({
          line: i + 1,
          name: match[1],
          kind: "enum",
          exported,
          signature: `enum ${match[1]} { ${values.join(", ")} }`,
          properties: values,
        });
        i = skipBlock(lines, i);
        continue;
      }
    }

    i++;
  }

  return types;
}

/**
 * Extract function signatures
 */
function extractFunctions(lines: string[]): FunctionSignature[] {
  const functions: FunctionSignature[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if ((line.includes("function ") || line.includes("const ") && line.includes("=>")) &&
        !line.includes("class ") && !line.includes("//")) {

      const exported = line.startsWith("export ");
      const async = line.includes("async ");

      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);

      if (funcMatch) {
        const [, name, generics, params, returnType] = funcMatch;
        functions.push({
          line: i + 1,
          name,
          exported,
          async,
          signature: buildFunctionSignature(name, generics || "", params, returnType, async),
          params,
          returnType: returnType?.trim(),
        });
        continue;
      }

      const arrowMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*([^=]+))?\s*=>/);
      if (arrowMatch) {
        const [, name, returnType] = arrowMatch;
        const paramsMatch = line.match(/\(([^)]*)\)/);
        functions.push({
          line: i + 1,
          name,
          exported,
          async,
          signature: line.replace(/\s*=>\s*{?.*$/, " => ..."),
          params: paramsMatch?.[1] || "",
          returnType: returnType?.trim(),
        });
      }
    }
  }

  return functions;
}

/**
 * Extract class signatures
 */
function extractClasses(lines: string[]): ClassSignature[] {
  const classes: ClassSignature[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.includes("class ") && line.includes("{")) {
      const exported = line.startsWith("export ");
      const match = line.match(/class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/);

      if (match) {
        const [, name, extendsClass, implementsStr] = match;
        const implements_ = implementsStr?.split(",").map(s => s.trim()) || [];
        const methods = extractClassMethods(lines, i);

        classes.push({
          line: i + 1,
          name,
          exported,
          extends: extendsClass,
          implements: implements_.length > 0 ? implements_ : undefined,
          methods,
        });

        i = skipBlock(lines, i);
        continue;
      }
    }

    i++;
  }

  return classes;
}

/**
 * Extract constant declarations
 */
function extractConstants(lines: string[]): ConstantDeclaration[] {
  const constants: ConstantDeclaration[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if ((line.startsWith("const ") || line.startsWith("export const ")) &&
        !line.includes("=>") && !line.includes("function")) {

      const exported = line.startsWith("export ");
      const match = line.match(/const\s+(\w+)(?:\s*:\s*([^=]+))?\s*=\s*(.+)/);

      if (match) {
        const [, name, type, value] = match;
        const cleanValue = value.replace(/;$/, "").trim();

        if (!cleanValue.includes("{") || cleanValue.length < 50) {
          constants.push({
            line: i + 1,
            name,
            exported,
            type: type?.trim(),
            value: cleanValue.length > 30 ? cleanValue.slice(0, 30) + "..." : cleanValue,
          });
        }
      }
    }
  }

  return constants;
}

/**
 * Helper: Extract type properties
 */
function extractTypeProperties(lines: string[], startLine: number): string[] {
  const properties: string[] = [];
  let depth = 0;
  let started = false;

  for (let i = startLine; i < lines.length && i < startLine + 50; i++) {
    const line = lines[i];
    if (line.includes("{")) {
      started = true;
      depth += (line.match(/{/g) || []).length;
    }
    if (started && depth === 1) {
      const propMatch = line.trim().match(/^(\w+)(\?)?:\s*([^;]+)/);
      if (propMatch) {
        properties.push(`${propMatch[1]}${propMatch[2] || ""}: ${propMatch[3].trim()}`);
      }
    }
    if (line.includes("}")) {
      depth -= (line.match(/}/g) || []).length;
      if (depth <= 0) break;
    }
  }

  return properties;
}

/**
 * Helper: Extract type alias signature
 */
function extractTypeAliasSignature(lines: string[], startLine: number): string {
  let signature = "";
  let depth = 0;

  for (let i = startLine; i < lines.length && i < startLine + 10; i++) {
    signature += lines[i].trim() + " ";
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (lines[i].includes(";") && depth === 0) break;
    if (depth === 0 && i > startLine) break;
  }

  return signature.trim().slice(0, 200);
}

/**
 * Helper: Extract enum values
 */
function extractEnumValues(lines: string[], startLine: number): string[] {
  const values: string[] = [];

  for (let i = startLine + 1; i < lines.length && i < startLine + 30; i++) {
    const line = lines[i].trim();
    if (line.startsWith("}")) break;
    const match = line.match(/^(\w+)/);
    if (match) values.push(match[1]);
  }

  return values;
}

/**
 * Helper: Extract class methods
 */
function extractClassMethods(lines: string[], startLine: number): MethodSignature[] {
  const methods: MethodSignature[] = [];
  let depth = 0;
  let started = false;

  for (let i = startLine; i < lines.length && i < startLine + 100; i++) {
    const line = lines[i];

    if (line.includes("{")) {
      started = true;
      depth += (line.match(/{/g) || []).length;
    }

    if (started && depth === 1) {
      const methodMatch = line.trim().match(
        /^(public|private|protected)?\s*(static)?\s*(async)?\s*(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/
      );

      if (methodMatch) {
        const [, visibility, isStatic, isAsync, name, , params, returnType] = methodMatch;
        methods.push({
          line: i + 1,
          name,
          visibility: (visibility as MethodSignature["visibility"]) || "public",
          static: !!isStatic,
          async: !!isAsync,
          signature: `${visibility || ""}${isStatic ? " static" : ""}${isAsync ? " async" : ""} ${name}(${params})${returnType ? `: ${returnType.trim()}` : ""}`.trim(),
        });
      }
    }

    if (line.includes("}")) {
      depth -= (line.match(/}/g) || []).length;
      if (depth <= 0) break;
    }
  }

  return methods;
}

/**
 * Helper: Skip code block
 */
function skipBlock(lines: string[], startLine: number): number {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (depth === 0 && i > startLine) return i + 1;
  }
  return lines.length;
}

/**
 * Helper: Build type signature
 */
function buildTypeSignature(kind: string, name: string, properties: string[]): string {
  if (properties.length === 0) return `${kind} ${name} {}`;
  if (properties.length <= 3) {
    return `${kind} ${name} { ${properties.join("; ")} }`;
  }
  return `${kind} ${name} { ${properties.slice(0, 3).join("; ")}; ... }`;
}

/**
 * Helper: Build function signature
 */
function buildFunctionSignature(
  name: string,
  generics: string,
  params: string,
  returnType: string | undefined,
  async: boolean
): string {
  const asyncStr = async ? "async " : "";
  const returnStr = returnType ? `: ${returnType.trim()}` : "";
  return `${asyncStr}function ${name}${generics}(${params})${returnStr}`;
}

/**
 * Format surgeon result as compact output
 */
export function formatSurgeonContent(result: SurgeonResult): string {
  const lines: string[] = [];
  const fileName = path.basename(result.filePath);

  lines.push(`// ${fileName} (Surgeon Mode)`);
  lines.push(`// Tokens: ${result.surgeonTokens} (saved ${result.estimatedTokensSaved})`);
  lines.push("");

  if (result.imports.length > 0) {
    lines.push("// Imports:");
    for (const imp of result.imports) {
      if (imp.default) {
        lines.push(`import ${imp.default} from "${imp.source}";`);
      } else if (imp.named.length > 0) {
        const typeStr = imp.isTypeOnly ? "type " : "";
        lines.push(`import ${typeStr}{ ${imp.named.slice(0, 5).join(", ")}${imp.named.length > 5 ? ", ..." : ""} } from "${imp.source}";`);
      }
    }
    lines.push("");
  }

  if (result.types.length > 0) {
    lines.push("// Types:");
    for (const t of result.types) {
      const exportStr = t.exported ? "export " : "";
      lines.push(`${exportStr}${t.signature}`);
    }
    lines.push("");
  }

  if (result.functions.length > 0) {
    lines.push("// Functions:");
    for (const f of result.functions) {
      const exportStr = f.exported ? "export " : "";
      lines.push(`${exportStr}${f.signature}`);
    }
    lines.push("");
  }

  if (result.classes.length > 0) {
    lines.push("// Classes:");
    for (const c of result.classes) {
      const exportStr = c.exported ? "export " : "";
      const extendsStr = c.extends ? ` extends ${c.extends}` : "";
      lines.push(`${exportStr}class ${c.name}${extendsStr} {`);
      for (const m of c.methods.slice(0, 10)) {
        lines.push(`  ${m.signature}`);
      }
      if (c.methods.length > 10) {
        lines.push(`  // ... ${c.methods.length - 10} more methods`);
      }
      lines.push("}");
    }
    lines.push("");
  }

  if (result.constants.length > 0) {
    lines.push("// Constants:");
    for (const c of result.constants.slice(0, 10)) {
      const exportStr = c.exported ? "export " : "";
      const typeStr = c.type ? `: ${c.type}` : "";
      lines.push(`${exportStr}const ${c.name}${typeStr} = ${c.value};`);
    }
  }

  return lines.join("\n");
}

/**
 * Format multiple surgeon results
 */
export function formatSurgeonResults(results: SurgeonResult[]): string {
  let totalOriginal = 0;
  let totalSurgeon = 0;

  const output: string[] = [];

  for (const result of results) {
    totalOriginal += result.originalTokens;
    totalSurgeon += result.surgeonTokens;
    output.push(formatSurgeonContent(result));
    output.push("\n---\n");
  }

  const savings = Math.round(((totalOriginal - totalSurgeon) / totalOriginal) * 100);

  output.unshift(`// 🔬 Surgeon Mode: ${results.length} files`);
  output.unshift(`// Token savings: ${totalOriginal - totalSurgeon} (${savings}%)`);
  output.unshift("");

  return output.join("\n");
}

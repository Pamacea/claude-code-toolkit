#!/usr/bin/env node
/**
 * PostToolUse hook for Read tool
 * Auto-truncates large file outputs to save tokens
 * Shows: first 50 lines + signatures + last 20 lines
 */
import { readFileSync } from "fs";

const MAX_LINES = 150; // Truncate files larger than this
const HEAD_LINES = 50; // Show first N lines
const TAIL_LINES = 20; // Show last N lines

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(0);
}

// Only handle Read tool
if (input.tool_name !== "Read") process.exit(0);

const result = input.tool_result;
if (!result || typeof result !== "string") process.exit(0);

// Count lines
const lines = result.split("\n");
const lineCount = lines.length;

if (lineCount <= MAX_LINES) process.exit(0);

// Extract file path from result (format: "1→content")
const filePath = input.tool_input?.file_path || "file";
const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

// Only truncate code files
const codeExts = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h"];
if (!codeExts.includes(ext)) process.exit(0);

// Extract signatures from the middle section
const middleLines = lines.slice(HEAD_LINES, -TAIL_LINES);
const signatures = [];

for (const line of middleLines) {
  const content = line.replace(/^\s*\d+→\s*/, ""); // Remove line number prefix

  // Match function/method signatures
  if (/^(export\s+)?(async\s+)?function\s+\w+/.test(content) ||
      /^(export\s+)?(const|let)\s+\w+\s*=\s*(async\s+)?\(/.test(content) ||
      /^(export\s+)?class\s+\w+/.test(content) ||
      /^(export\s+)?(interface|type)\s+\w+/.test(content) ||
      /^\s*(public|private|protected)?\s*(async\s+)?\w+\s*\(/.test(content)) {

    // Extract just the signature (first line)
    const sig = content.split("{")[0].split("=>")[0].trim();
    if (sig.length > 10 && sig.length < 200) {
      signatures.push(sig);
    }
  }
}

// Build truncation message
const truncatedCount = lineCount - HEAD_LINES - TAIL_LINES;
let message = `\n⚠️ **File truncated** (${lineCount} lines → ${HEAD_LINES + TAIL_LINES} shown)\n`;
message += `📄 ${filePath}\n\n`;

if (signatures.length > 0) {
  message += `**Signatures in hidden section (${truncatedCount} lines):**\n`;
  signatures.slice(0, 15).forEach(sig => {
    message += `  • ${sig.slice(0, 100)}${sig.length > 100 ? "..." : ""}\n`;
  });
  if (signatures.length > 15) {
    message += `  ... and ${signatures.length - 15} more\n`;
  }
  message += `\n`;
}

message += `💡 To see full file: Read with offset/limit or use \`rag:context "${filePath}" --signatures-only\``;

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    decision: "continue",
    reason: message
  }
}));

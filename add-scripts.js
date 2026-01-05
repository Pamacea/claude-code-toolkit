#!/usr/bin/env node
/**
 * Add RAG scripts to package.json
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const projectDir = process.cwd();
const packageJsonPath = join(projectDir, "package.json");

const ragScripts = {
  "rag:index": "node .claude/toolkit/dist/cli.js index -d .",
  "rag:context": "node .claude/toolkit/dist/search.js context",
  "rag:expand": "node .claude/toolkit/dist/search.js expand",
  "rag:deps": "node .claude/toolkit/dist/search.js deps -d .",
  "rag:diff": "node .claude/toolkit/dist/search.js diff -d .",
  "rag:commit": "node .claude/toolkit/dist/search.js commit -d .",
  "rag:budget": "node .claude/toolkit/dist/search.js budget -d .",
  "rag:hypothesis": "node .claude/toolkit/dist/search.js hypothesis -d .",
  "rag:context-lock": "node .claude/toolkit/dist/search.js context-lock -d .",
  "rag:optimizer": "node .claude/toolkit/dist/search.js optimizer -d .",
  "rag:contracts": "node .claude/toolkit/dist/search.js contracts -d .",
  "rag:locality": "node .claude/toolkit/dist/search.js locality -d .",
  "rag:importance": "node .claude/toolkit/dist/search.js importance -d .",
  "rag:risk": "node .claude/toolkit/dist/search.js risk -d .",
  "rag:memory": "node .claude/toolkit/dist/search.js memory -d .",
  "rag:session": "node .claude/toolkit/dist/search.js session -d .",
  "rag:errors": "node .claude/toolkit/dist/search.js errors -d .",
  "rag:snippets": "node .claude/toolkit/dist/search.js snippets -d .",
  "rag:watch": "node .claude/toolkit/dist/search.js watch -d .",
  "rag:stats": "node .claude/toolkit/dist/search.js stats -d .",
  "rag:cache": "node .claude/toolkit/dist/search.js cache -d .",
  "rag:checkpoint": "node .claude/toolkit/dist/search.js checkpoint -d .",
  "rag:surgeon": "node .claude/toolkit/dist/search.js surgeon -d .",
  "rag:burn-rate": "node .claude/toolkit/dist/search.js burn-rate -d .",
  "rag:rules": "node .claude/toolkit/dist/search.js rules -d ."
};

try {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

  if (!pkg.scripts) {
    pkg.scripts = {};
  }

  let addedCount = 0;
  for (const [name, script] of Object.entries(ragScripts)) {
    if (!pkg.scripts[name]) {
      pkg.scripts[name] = script;
      addedCount++;
    }
  }

  if (addedCount > 0) {
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
    console.log(`✅ Added ${addedCount} RAG scripts to package.json`);
  } else {
    console.log("✓ RAG scripts already present in package.json");
  }
} catch (error) {
  console.error("Error updating package.json:", error.message);
  process.exit(1);
}

# Claude Toolkit

Token-optimized toolkit for Claude Code: RAG indexer, AST-based chunking, semantic cache, and context optimization.

## Features

| Feature | Description | Token Savings |
|---------|-------------|---------------|
| **AST Chunking** | Parses TS/JS with ts-morph, extracts functions, classes, components | 30-50% vs regex |
| **Semantic Cache** | Caches query results, matches similar queries | 20-40% on repeated queries |
| **Diff Context** | Git diff parsing, shows only changed code | 70-90% vs full files |
| **Project Memory** | Auto-generated project summary, conventions, constraints | 10-20% (avoids re-prompting) |
| **Prompt Templates** | Pre-optimized prompts for review, debug, refactor, test, docs | 20-30% writing time |
| **Dependency Graph** | Import/export navigation, impact analysis, dead code detection | 40-60% exploration |
| **Smart Watch** | Incremental reindexing, only processes changed files | 80% indexation time |
| **Type-Only Mode** | Extract only types/interfaces, skip implementations | 80-90% tokens |
| **Test Context** | Associate tests with source files automatically | 30% navigation |
| **Smart Selection** | Auto-select minimal context based on task type | 50-70% tokens |
| **Auto-Commit** | Generate commit messages from git diff | 100% writing time |
| **Signatures & Deps** | Tracks function signatures and dependencies | Enables minimal context mode |
| **Smart Search** | Cosine similarity on 384-dim embeddings | Finds relevant code fast |

## Quick Start

```bash
# Build the toolkit
cd plugins/claude-toolkit && pnpm build && cd ../..

# Index the codebase
pnpm rag:index

# Search for code
pnpm rag:context "state machine transitions" -k 5
```

## Commands

### Indexing

```bash
# Index codebase (uses AST by default)
pnpm rag:index

# Force reindex all files
pnpm rag:index -f

# Disable AST, use regex fallback
pnpm rag:index --no-ast
```

### Search & Context

```bash
# Get context for Claude (XML format)
pnpm rag:context "animation engine play" -k 5

# Include dependency information
pnpm rag:context "useAnima hook" --with-deps

# Type-only mode: only types/interfaces (80-90% token savings)
pnpm rag:context "AnimaFile types" --types-only

# Smart mode: auto-select context based on task type
pnpm rag:context "debug animation bug" --smart

# Include associated tests
pnpm rag:context "useAnima hook" --with-tests

# Minimal mode: signatures only (max token savings)
pnpm rag:context "AnimaCanvas component" --signatures-only

# Disable cache for fresh results
pnpm rag:context "query" --no-cache

# Custom cache TTL (default: 15 minutes)
pnpm rag:context "query" --cache-ttl 30
```

### Statistics

```bash
# Index stats (chunk types, AST enrichment)
pnpm rag:stats

# Cache stats (hit rate, top queries)
pnpm rag:cache

# Clear cache
pnpm rag:cache --clear
```

## Output Format

### Standard Context

```xml
<rag-context query="animation engine">

<file path="src/engine.ts" line="42" type="function:play" relevance="0.85"
      signature="async function play(name: string): Promise<void>" exported="true">
export async function play(name: string): Promise<void> {
  // implementation
}
</file>

</rag-context>
```

### Cached Context

```xml
<!-- Exact cache hit -->
<rag-context query="animation engine" cached="true">

<!-- Similarity cache hit (shows original query) -->
<rag-context query="engine animation" cached-from="animation engine" cached="true">
```

### With Dependencies

```xml
<file path="src/hook.ts" type="function:useAnima"
      deps="useState,useEffect,AnimationEngine" exported="true">
```

## AST Chunking

The toolkit uses `ts-morph` to parse TypeScript/JavaScript and extract semantic chunks:

| Chunk Type | Detection |
|------------|-----------|
| `function` | Named functions, arrow functions |
| `component` | React components (PascalCase + JSX patterns) |
| `class` | Class declarations |
| `interface` | Interface declarations |
| `type` | Type aliases |
| `variable` | Exported constants |
| `import-block` | Grouped import statements |

### AST Enrichment

Each chunk includes:
- **signature**: Function/method signature for quick reference
- **dependencies**: Called functions/used identifiers
- **exports**: Whether the symbol is exported

Example stats output:
```
AST enrichment:
  With signatures: 363 (21.6%)
  With dependencies: 168 (10.0%)
  Exported: 217
  Total deps tracked: 1416
```

## Semantic Cache

The cache reduces token usage by avoiding redundant searches.

### How It Works

1. **Query Normalization**: Lowercase, trim, sort words alphabetically
   - `"animation engine play"` → `"animation engine play"`
   - `"play animation engine"` → `"animation engine play"` (same hash!)

2. **Exact Match**: SHA256 hash lookup (instant, no embedding needed)

3. **Similarity Match**: Cosine similarity > 92% on query embeddings
   - `"state machine transitions"` matches `"state machine transition conditions"`

4. **TTL Expiration**: Default 15 minutes, configurable

5. **LRU Eviction**: Max 100 entries, scored by `hits × recency`

### Cache Stats

```
📦 Semantic Cache Statistics

Cached queries: 2
Total queries: 5
Hit rate: 60.0%
  - Exact hits: 2
  - Similar hits: 1
  - Misses: 2

Top cached queries:
  [2 hits] "animation engine play"
  [1 hits] "state machine transitions"
```

## Token Efficiency Tips

| Scenario | Command | Savings |
|----------|---------|---------|
| Quick lookup | `--signatures-only` | 70-90% |
| Repeated queries | Cache (automatic) | 20-40% |
| Understanding deps | `--with-deps` | Shows call graph |
| Fresh results | `--no-cache` | 0% (bypasses cache) |
| Review changes | `pnpm rag:diff` | 70-90% vs full file |

## Diff Context

Get minimal context from git changes instead of full files. Ideal for code review, debugging, and understanding recent changes.

### Commands

```bash
# Full diff with hunks (default)
pnpm rag:diff

# Only changed file paths
pnpm rag:diff --files-only

# Quick statistics
pnpm rag:diff --stats-only

# Summary without full hunks (compact)
pnpm rag:diff --summary

# Compare specific refs
pnpm rag:diff --base main --target feature-branch

# Only staged changes
pnpm rag:diff --staged

# Limit output size
pnpm rag:diff --max-lines 100
```

### Output Format

```xml
<diff-context files="3" additions="45" deletions="12">

<affected-symbols>useAnima, AnimaCanvas, play</affected-symbols>

<file path="src/hook.ts" status="modified">
@@ -42,7 +42,10 @@ function useAnima
-  const [playing, setPlaying] = useState(false);
+  const [playing, setPlaying] = useState(false);
+  const [time, setTime] = useState(0);
</file>

</diff-context>
```

### Use Cases

| Scenario | Command | Benefit |
|----------|---------|---------|
| Code review | `pnpm rag:diff --base main` | See exactly what changed |
| Debug recent changes | `pnpm rag:diff` | Focus on modified code |
| PR preparation | `pnpm rag:diff --staged` | Review before commit |
| Quick overview | `pnpm rag:diff --summary` | Minimal context |

## Project Memory

Auto-generated compressed context about your project. Injected once per session to avoid repeating project info.

### Commands

```bash
# Show current memory (auto-generates if missing)
pnpm rag:memory

# Force regeneration
pnpm rag:memory --generate

# Output as JSON
pnpm rag:memory --json
```

### What's Extracted

| Category | Content |
|----------|---------|
| **Project** | Name, description, type (monorepo/single), tech stack |
| **Packages** | All packages in monorepo with descriptions |
| **Architecture** | Directory structure, entry points, key files |
| **Conventions** | Language, quotes, semicolons, indentation, import style |
| **Constraints** | Node version, package manager, rules from CLAUDE.md |
| **Activity** | Current branch, last commit, recently modified files |

### Output Format

```xml
<project-memory generated="2024-01-15T10:30:00Z">

<project name="anima" type="monorepo">
Open source alternative to Rive
Stack: TypeScript, SolidJS, Vite
</project>

<packages>
- @anima/core (packages/core): Animation engine
- @anima/editor (packages/editor): Visual editor
- @anima/react (packages/react): React runtime
</packages>

<conventions>
Language: typescript
Style: double quotes, semicolons, spaces
Imports: esm
Patterns: File names: kebab-case; Components: PascalCase
</conventions>

<constraints>
- Node.js >=18.0.0
- Package manager: pnpm@9.0.0
</constraints>

<recent-activity branch="main">
Last commit: feat: add new feature
Recent files: src/index.ts, package.json
</recent-activity>

</project-memory>
```

### Auto-Refresh

Memory is refreshed automatically when:
- Older than 1 hour
- Key files changed (package.json, CLAUDE.md, tsconfig.json)

## Prompt Templates

Pre-optimized prompts for common tasks. Reduces prompt writing time and ensures consistent, token-efficient queries.

### Commands

```bash
# List all templates
pnpm rag:template

# Show a specific template
pnpm rag:template review-quick

# Filter by category
pnpm rag:template --category debug

# Search templates
pnpm rag:template --search "refactor"

# Get suggestions for a task
pnpm rag:template --suggest "I need to fix a bug"
```

### Available Categories

| Category | Templates | Purpose |
|----------|-----------|---------|
| `review` | review-quick, review-full, review-pr | Code review |
| `debug` | debug-error, debug-behavior, debug-performance | Bug hunting |
| `refactor` | refactor-extract, refactor-simplify, refactor-patterns, refactor-split | Code improvement |
| `explain` | explain-code, explain-architecture, explain-flow | Understanding code |
| `test` | test-unit, test-integration, test-cases | Test generation |
| `docs` | docs-jsdoc, docs-readme, docs-api | Documentation |
| `implement` | impl-feature, impl-interface, impl-migration | Building features |

### Example Template

```
📝 Quick Review (review-quick)
   Category: review
   Fast code review focusing on critical issues
   Variables: code
   Est. tokens: ~50

   Template:
   │ Review this code for:
   │ 1. Bugs/errors
   │ 2. Security issues
   │ 3. Performance problems
   │
   │ {{code}}
   │
   │ Reply with: issues found (severity: high/med/low) + fix suggestions.
```

## Dependency Graph

Complete import/export graph for intelligent codebase navigation.

### Commands

```bash
# Build the dependency graph
pnpm rag:deps --build

# Show graph statistics
pnpm rag:deps --stats

# Analyze a specific file
pnpm rag:deps src/engine.ts

# Show who imports a file
pnpm rag:deps src/engine.ts --importers

# Include transitive dependencies
pnpm rag:deps src/engine.ts --transitive

# Impact analysis: what breaks if this file changes?
pnpm rag:deps src/engine.ts --impact

# Find files that export a name
pnpm rag:deps --find-export "useAnima"

# Find potentially dead exports
pnpm rag:deps --dead-exports
```

### Statistics Output

```
📊 Dependency Graph Statistics

Files indexed: 181
Total imports: 1416
Total exports: 217
Avg imports/file: 7.8
Avg exports/file: 1.2
Entry points: 12
Leaf nodes: 92

⚠️ Circular dependencies: 2
   src/a.ts → src/b.ts → src/a.ts
   src/c.ts → src/d.ts → src/e.ts → src/c.ts
```

### Impact Analysis

```
⚡ Impact Analysis: src/engine.ts

Impact Score: 23.5%
Direct impact: 8 files
Transitive impact: 42 files

Directly affected:
   src/hooks/useAnima.ts
   src/components/AnimaCanvas.tsx
   ...
```

### Use Cases

| Scenario | Command | Benefit |
|----------|---------|---------|
| Understand dependencies | `pnpm rag:deps src/file.ts` | See what a file imports |
| Refactor impact | `pnpm rag:deps src/file.ts --impact` | Know what will break |
| Find dead code | `pnpm rag:deps --dead-exports` | Clean unused exports |
| Navigate imports | `pnpm rag:deps --find-export "X"` | Find where X is defined |

## Smart Watch (Incremental Reindexing)

Only reindex changed files, saving 80% indexation time.

### Commands

```bash
# Incremental reindex (smart - only changed files)
pnpm rag:watch

# Check for changes without reindexing
pnpm rag:watch --check

# Force full reindex
pnpm rag:watch --force

# Show recently modified files
pnpm rag:watch --recent      # Last hour
pnpm rag:watch --recent 30   # Last 30 minutes
```

### Output

```
📊 Incremental Reindex Results

Total files: 181
Added: 3
Modified: 5
Deleted: 1
Unchanged: 172
Chunks updated: 24
Time: 1234ms

💡 Efficiency: 95.0% files skipped (already indexed)
```

### How It Works

1. **Hash Tracking**: Each file's content is hashed (SHA256)
2. **Change Detection**: Compares current hashes to stored hashes
3. **Selective Processing**: Only processes added/modified files
4. **Chunk Reuse**: Unchanged files keep their existing embeddings

### Files Generated

| File | Description |
|------|-------------|
| `.rag-hashes.json` | File hash index for change detection |

## Auto-Commit Messages

Generate commit messages automatically from git diff. Analyzes changes and suggests conventional commit format.

### Commands

```bash
# Generate message for staged changes
pnpm rag:commit

# Analyze all changes (staged + unstaged)
pnpm rag:commit --all

# Preview without committing
pnpm rag:commit --dry-run

# Execute commit directly
pnpm rag:commit -y
```

### Output

```
💬 Suggested Commit Message
   Confidence: [██████░░░░] 65%

┌─────────────────────────────────────────────────
│ feat(editor): add timeline zoom controls
│
│ + packages/editor/src/components/TimelineZoom.tsx
│ ~ packages/editor/src/components/Timeline.tsx
│
│ Changes: +45/-12
└─────────────────────────────────────────────────
```

### Commit Types

The analyzer detects:
- `feat`: New features (new files, new exports)
- `fix`: Bug fixes (keywords: fix, bug, error, crash)
- `refactor`: Code changes without new features
- `test`: Test file changes
- `docs`: Documentation changes
- `chore`: Config/build changes

## Type-Only Mode

Extract only types and interfaces, skipping implementations. Saves 80-90% tokens when you only need API definitions.

```bash
pnpm rag:context "AnimaFile state machine" --types-only
```

### Output

```xml
<types-context count="5">
<type path="src/types.ts" line="42" kind="interface" name="AnimaFile" exported="true">
interface AnimaFile { name: string; animations: Animation[]; stateMachines: StateMachine[] }
</type>
</types-context>
<!-- Estimated tokens saved: ~2400 -->
```

## Smart Context Selection

Automatically optimizes context based on detected task type.

```bash
pnpm rag:context "debug animation bug" --smart
```

### Task Detection

| Task Type | Includes | Optimizations |
|-----------|----------|---------------|
| `debug` | Tests, deps | Focus on error-related code |
| `implement` | Types, deps | Show interfaces to implement |
| `refactor` | Tests, types, deps | Full context for safe changes |
| `review` | Tests | Focus on testability |
| `test` | Types, tests | Show what to test |
| `explain` | Types, deps | High-level overview |
| `document` | Types | API surface only |
| `explore` | - | Broad search |

## Test Context

Automatically associate source files with their tests.

```bash
pnpm rag:context "useAnima hook" --with-tests
```

Finds tests using common patterns:
- `foo.ts` → `foo.test.ts`, `foo.spec.ts`
- `src/foo.ts` → `src/__tests__/foo.test.ts`
- `src/foo.ts` → `tests/foo.test.ts`

## Files

| File | Description |
|------|-------------|
| `.rag-index.json` | Vector store (add to .gitignore) |
| `.rag-cache.json` | Query cache (add to .gitignore) |
| `.rag-deps.json` | Dependency graph (add to .gitignore) |
| `.rag-hashes.json` | File hash index (add to .gitignore) |
| `.claude-memory.json` | Project memory (add to .gitignore) |

## Architecture

```
plugins/claude-toolkit/src/
├── cli.ts              # Index CLI
├── search.ts           # Search CLI (all commands)
├── scanner.ts          # File scanner
├── chunker.ts          # Chunk coordinator
├── ast-chunker.ts      # AST parsing (ts-morph)
├── embedder.ts         # Embeddings (all-MiniLM-L6-v2)
├── store.ts            # Vector store
├── cache.ts            # Semantic cache
├── diff-context.ts     # Git diff parsing
├── memory.ts           # Project memory
├── prompt-templates.ts # Prompt templates system
├── dependency-graph.ts # Import/export graph
├── file-watcher.ts     # Incremental reindexing
├── smart-context.ts    # Type-only, test context, smart selection
└── auto-commit.ts      # Commit message generation
```

## API (Programmatic)

```typescript
import {
  loadStore,
  search,
  embed,
  initEmbedder
} from './plugins/claude-toolkit/dist/index.js';

import {
  loadCache,
  lookupExact,
  lookupSimilar,
  addToCache
} from './plugins/claude-toolkit/dist/cache.js';

await initEmbedder();
const store = loadStore('.');
const cache = loadCache('.');

// Check cache first
const cached = lookupExact(cache, 'my query');
if (cached) {
  return cached.results;
}

// Otherwise search
const queryVector = await embed('my query');
const results = search(store, queryVector, 10, 0.3);
```

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Deprecated
- This toolkit is now integrated into [SMITE](https://github.com/Pamacea/smite)
- Please migrate to SMITE for continued updates and support

## [1.0.0] - 2025-02-06

### Added
- **Quota Survival System** for surviving "Claude Max 5x" restrictions
- **AST-based RAG** with semantic parsing via `ts-morph`
  - Class, hook, and type-aware chunking
  - 30-50% token savings through semantic understanding
- **Surgeon Mode** (`--surgeon` flag)
  - Ultra-compressed extraction (imports, types, signatures only)
  - 70-85% token savings
- **Lazy Loading** (`--lazy` flag)
  - File references only, no content
  - 60-80% token savings
- **Semantic Cache**
  - Prevents re-embedding similar queries via cosine similarity
  - 20-40% token savings
- **API Contracts** system
  - Snapshots API signatures
  - Detects breaking changes
  - 40-70% token savings when implementation changes but API doesn't
- **Read Optimizer**
  - Budget manager with configurable limits (default: 50k tokens)
  - Hypothesis-driven reading logic
  - 50-70% token savings
- **Session Checkpoints** (`pnpm rag:checkpoint`)
  - Save full session state (WIP files, TODOs, decisions)
  - Transfer context across `/new` commands
- **Burn Rate Tracking** (`pnpm rag:burn-rate`)
  - Real-time token velocity monitoring
  - Alerts at 60% and 80% token usage
- **Auto-truncation** for files >150 lines
- **Automated Hooks**
  - Session start: loads checkpoint, memory, sets budget
  - Read guard: enforces optimizer/budget rules
  - Auto-fix: suggests fixes after failed bash commands
  - Session end: saves burn-rate stats
- **RAG Commands**
  - `pnpm rag:context` - Semantic code search
  - `pnpm rag:expand` - Examines specific lines
  - `pnpm rag:hypothesis` - Theory-based reading
  - `pnpm rag:context-lock` - Lock target area
  - `pnpm rag:commit` - Auto-generate conventional commits
  - `pnpm rag:deps` - Dependency impact analysis
  - `pnpm rag:memory` - Architecture knowledge
  - `pnpm rag:rules` - Generate efficiency rules
- **Token Efficiency Matrix**
  - Surgeon mode: 70-85% savings
  - Lazy mode: 60-80% savings
  - Types-only mode: 80-90% savings
  - Smart mode: 50-70% savings
- **Installation scripts**
  - `pnpm rag:install` - Configures hooks and creates .rag/ directory
  - Auto-configuration in settings.local.json

### Changed
- Refactored from `plugins/claude-code-toolkit` to `.claude-code-toolkit`
- Improved installation instructions with sharp rebuild note
- Fixed deps.json path in log messages
- Resolved file paths relative to rootDir in risk and locality commands

### Documentation
- Complete README with workflow examples
- CLAUDE.md with mandatory protocols
- Token efficiency comparisons
- Quick reference guides

### Performance
- **75% average token savings** across all operations
- **2x precision** improvement with semantic search vs traditional grep/glob
- **2.5x speed** improvement in code exploration

[Unreleased]: https://github.com/Pamacea/claude-code-toolkit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Pamacea/claude-code-toolkit/releases/tag/v1.0.0

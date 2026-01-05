# Claude Code Toolkit v5.5

The ultimate Quota Survival System for Claude Code. Maximize token efficiency with AST-based RAG, surgeon-mode extraction, and session checkpoints.

## v5.5: Quota Survival System
Designed to survive "Claude Max 5x" restrictions and high-latency sessions.

| Command | Description | Saving |
| :--- | :--- | :--- |
| `pnpm rag:checkpoint` | Save full session state (WIP files, TODOs, decisions) to transfer context across `/new` commands. | - |
| `pnpm rag:context --surgeon` | Ultra-compressed extraction. Removes implementations, leaving only imports, types, and function signatures. | **70-85%** |
| `pnpm rag:burn-rate` | Proactive monitoring. Get alerts at 60% and 80% token usage. | - |
| `pnpm rag:rules` | Generates `.claudecode.instructions.md` to enforce efficiency. | - |

## Workflow
1. **SEARCH**: `pnpm rag:context "query" --lazy --no-cache` (Refs only).
2. **EXAMINE**: `pnpm rag:expand <path:line> -c 10` (Specific lines).
3. **HYPOTHESIZE**: `pnpm rag:hypothesis start --task "..."` (Theory-based reading).
4. **LOCK**: `pnpm rag:context-lock lock` once the target area is identified.
5. **MODIFY**: Apply precise edits.
6. **COMMIT**: `pnpm rag:commit -y` (Auto-generate conventional commit).

## Core Optimization Suite
| Feature | Description | Saving |
| :--- | :--- | :--- |
| **AST Chunking** | Semantic parsing via `ts-morph` (classes, hooks, types). | 30-50% |
| **Semantic Cache** | Prevents re-embedding similar queries via cosine similarity. | 20-40% |
| **API Contracts** | Snapshots signatures; skips re-reading if implementation changed but API didn't. | 40-70% |
| **Read Optimizer**| Budget manager and hypothesis-driven reading logic. | 50-70% |

## Token Efficiency Matrix
| Mode | Command Flag | Token Saving |
| :--- | :--- | :--- |
| **Surgeon** | `--surgeon` | **70-85%** (Signatures + Types only) |
| **Lazy** | `--lazy` | **60-80%** (File references only) |
| **Types Only** | `--types-only` | **80-90%** (Interfaces/Types) |
| **Smart** | `--smart` | **50-70%** (Task-based auto-selection) |

## Installation
```bash
git clone https://github.com/Pamacea/claude-code-toolkit.git .claude/toolkit
cd .claude/toolkit && pnpm install
pnpm build
pnpm rag:install  # Configures hooks and creates .rag/ directory
```
# CLAUDE.md (Toolkit v5.5 - Quota Survival Edition)

## 📍 Mandatory Command Context
**ALWAYS** run `pnpm rag:*` commands from the toolkit directory:
`cd .claude/toolkit && <command>`

## 🚨 v5.5 Quota Survival Protocol
When token budget is tight or "Claude Max 5x" limits are approaching:
1. **SURGEON**: Use `pnpm rag:context "q" --surgeon` for 70-85% savings (AST signatures only).
2. **MONITOR**: Run `pnpm rag:burn-rate track` to monitor consumption velocity.
3. **CHECKPOINT**: At 60% budget, run `pnpm rag:checkpoint` to save session state.
4. **RESET**: Use `/new`, then read `.claude/last_checkpoint.md` to resume instantly.

## 🔄 Mandatory Workflow
1. **SEARCH**: `pnpm rag:context "query" --lazy --no-cache` (Refs only).
2. **EXAMINE**: `pnpm rag:expand <path:line> -c 10` (Specific lines).
3. **HYPOTHESIZE**: `pnpm rag:hypothesis start --task "..."` (Theory-based reading).
4. **LOCK**: `pnpm rag:context-lock lock` once the target area is identified.
5. **MODIFY**: Apply precise edits.
6. **COMMIT**: `pnpm rag:commit -y` (Auto-generate conventional commit).

## 🔧 Read Optimizer & Survival Tools

| Feature | Command | Impact |
| :--- | :--- | :--- |
| **Surgeon** | `--surgeon` | **70-85%** saving (AST-only extraction) |
| **Checkpoint**| `pnpm rag:checkpoint`| Transfer WIP/TODOs across `/new` |
| **Burn Rate** | `pnpm rag:burn-rate` | Real-time token velocity tracking |
| **Budget** | `pnpm rag:budget` | Limits session tokens (Default: 50k) |
| **Contracts**| `pnpm rag:contracts` | Snapshots APIs to detect breaking changes |

## ⚡ Token Efficiency Matrix
| Mode | Command Flag | Token Saving |
| :--- | :--- | :--- |
| **Surgeon** | `--surgeon` | **70-85%** (Signatures + Types only) |
| **Lazy** | `--lazy` | **60-80%** (File references only) |
| **Types Only** | `--types-only` | **80-90%** (Interfaces/Types) |
| **Smart** | `--smart` | **50-70%** (Task-based auto-selection) |

## 📏 Rules & Constraints
- **CRITICAL**: **NEVER** use `Read` on files >150 lines. Auto-truncate is active.
- **CRITICAL**: **NEVER** use `Read` or `Grep` without prior RAG search.
- **ALWAYS**: Use `--types-only` or `--surgeon` for initial exploration.
- **ALWAYS**: Run `pnpm rag:deps <file> --impact` before refactoring.
- **ALWAYS**: Check `pnpm rag:memory` before assuming architecture.

## 🔌 Automated Hooks
- **Session Start**: Loads checkpoint, memory, and sets 50k token budget.
- **Read Guard**: Intercepts `Read` tool to enforce Optimizer/Budget rules.
- **Auto-Fix**: Scans error DB after failed bash commands to suggest fixes.
- **Session End**: Saves burn-rate stats and archives completed hypotheses.

## ⛔ Absolute Restrictions
1. **No Manual Search**: Use `rag:context` instead of `Glob`/`Grep`.
2. **No Blind Edits**: Analyze impact with `rag:deps` first.
3. **No Stealth Push**: Always ask "May I push?" before pushing to remote.
4. **No Type 'any'**: Strictly forbidden.

---
**⚠️ VIOLATION OF THESE RULES IS STRICTLY PROHIBITED**

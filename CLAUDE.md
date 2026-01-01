# Claude Toolkit v4.2 - Instructions OBLIGATOIRES

## 🔌 Hooks Installés (Automatiques)

| Hook | Déclencheur | Action |
|------|-------------|--------|
| **session-start** | SessionStart | Charge session + memory + reindex si besoin |
| **session-end** | Stop | Sauvegarde état session |
| **smart-files** | PreToolUse (Edit) | Affiche fichiers liés (importers/imports) |
| **auto-fix** | PostToolUse (Bash) | Cherche erreur dans DB + suggère fix |
| **suggest-rag** | PreToolUse (Read) | Rappelle d'utiliser RAG avant Read |

## ⛔ RÈGLES ABSOLUES - VIOLATIONS INTERDITES

### 1. JAMAIS de Read sans RAG
```
❌ INTERDIT : Read("src/components/Timeline.tsx")
✅ OBLIGATOIRE : pnpm rag:context "timeline component" → puis Read le fichier trouvé
```

### 2. JAMAIS de recherche manuelle avec Glob/Grep en premier
```
❌ INTERDIT : Glob("**/*.tsx") pour chercher un composant
✅ OBLIGATOIRE : pnpm rag:context "component name" -k 5
```

### 3. JAMAIS lire un fichier en entier sans raison
```
❌ INTERDIT : Read un fichier de 500+ lignes en entier
✅ OBLIGATOIRE : --signatures-only ou --types-only pour explorer
```

### 4. JAMAIS push sans autorisation explicite
```
❌ INTERDIT : git push (automatique)
✅ OBLIGATOIRE : Demander "Puis-je push ?"
```

---

## 🔧 TOOLKIT OBLIGATOIRE - Utilisation Systématique

### Avant TOUTE action sur le code :

| Action | Commande OBLIGATOIRE |
|--------|---------------------|
| Chercher du code | `pnpm rag:context "<query>" -k 5` |
| Comprendre les types | `pnpm rag:context "<query>" --types-only` |
| Debug un bug | `pnpm rag:context "<query>" --smart` |
| Voir les tests associés | `pnpm rag:context "<query>" --with-tests` |
| Voir les dépendances | `pnpm rag:deps <file> --impact` |
| Voir les changements | `pnpm rag:diff --summary` |
| Générer un commit | `pnpm rag:commit --dry-run` |

### Workflow OBLIGATOIRE : RAG → Read → Edit

```
1. pnpm rag:context "ce que je cherche" -k 5
2. Identifier le fichier exact et les lignes
3. Read UNIQUEMENT les lignes nécessaires
4. Edit avec précision
```

---

## 📋 Commandes Disponibles

| Commande | Usage | Économie |
|----------|-------|----------|
| `pnpm rag:context "q"` | Recherche sémantique | 50-70% tokens |
| `pnpm rag:context "q" --types-only` | Types/interfaces seulement | **80-90% tokens** |
| `pnpm rag:context "q" --smart` | Sélection intelligente auto | 50-70% tokens |
| `pnpm rag:context "q" --with-tests` | Avec tests associés | +30% contexte utile |
| `pnpm rag:context "q" --with-deps` | Avec dépendances | +infos imports |
| `pnpm rag:context "q" --signatures-only` | Signatures uniquement | 70% tokens |
| `pnpm rag:diff` | Diff git structuré | 70-90% tokens |
| `pnpm rag:diff --summary` | Résumé rapide | 90% tokens |
| `pnpm rag:diff --staged` | Changements staged | Avant commit |
| `pnpm rag:memory` | Contexte projet | Auto au démarrage |
| `pnpm rag:deps --build` | Construire graphe deps | Une fois |
| `pnpm rag:deps <file>` | Deps d'un fichier | Navigation |
| `pnpm rag:deps <file> --impact` | Analyse d'impact | **Avant refactor** |
| `pnpm rag:deps --dead-exports` | Code mort | Nettoyage |
| `pnpm rag:commit` | Générer message commit | **100% écriture** |
| `pnpm rag:commit --dry-run` | Prévisualiser | Sans commiter |
| `pnpm rag:commit -y` | Commiter directement | Rapide |
| `pnpm rag:watch` | Réindexer (incrémental) | 80% temps |
| `pnpm rag:watch --check` | Vérifier changements | Sans réindexer |
| `pnpm rag:template` | Templates de prompts | 20-30% écriture |
| `pnpm rag:cache` | Stats du cache | Debug |
| `pnpm rag:stats` | Stats de l'index | Debug |
| `pnpm rag:session` | Résumé session actuelle | Continuité |
| `pnpm rag:session --compact` | Résumé court | Quick check |
| `pnpm rag:errors find -m "msg"` | Chercher erreur connue | Debug rapide |
| `pnpm rag:errors add ...` | Ajouter erreur résolue | **Obligatoire** |
| `pnpm rag:snippets --search "q"` | Chercher snippet | Réutilisation |
| `pnpm rag:snippets add ...` | Ajouter snippet | **Obligatoire** |

---

## 🧠 Features Automatiques (v4.2)

### Session Continuity
- **Auto-load** au démarrage : session précédente + memory + reindex
- **Auto-save** à la fin : fichiers modifiés, dernier commit, durée

### Smart Files
Quand tu Edit un fichier `.ts/.tsx`, le hook affiche :
```
📁 Related: ← Component.tsx (imports this), → types.ts (imported)
```

### Auto-Fix Suggestions
Quand une commande Bash échoue :
1. Le hook cherche dans la DB d'erreurs
2. Si match trouvé → affiche solution + code à changer
3. Tu peux appliquer le fix directement

### Error Pattern DB
**OBLIGATOIRE** : Quand tu résous une erreur difficile, ajoute-la :
```bash
pnpm rag:errors add -t "TypeError" -m "Cannot read property X" -s "Vérifier null/undefined" --tags "typescript"
```

### Code Snippets
**OBLIGATOIRE** : Quand tu crées un pattern réutilisable, sauvegarde-le :
```bash
pnpm rag:snippets add -n "useDebounce" --desc "Hook debounce" --code "const [value] = useDebounce(input, 300)"
```

---

## 🎯 Scénarios d'Usage

### Comprendre un composant
```bash
pnpm rag:context "Timeline component" --signatures-only
# Puis si besoin de détails :
pnpm rag:context "Timeline component" -k 3
```

### Implémenter une feature
```bash
pnpm rag:context "feature keyword" --smart
# Le mode smart détecte "implement" et inclut types + deps
```

### Debug un bug
```bash
pnpm rag:context "error description" --smart --with-tests
# Le mode smart détecte "debug" et inclut tests + deps
```

### Refactorer
```bash
pnpm rag:deps src/file.ts --impact
# Voir qui sera affecté AVANT de modifier
pnpm rag:context "file to refactor" --smart
```

### Commiter
```bash
pnpm rag:commit --dry-run
# Voir le message suggéré, puis :
pnpm rag:commit -y
```

---

## 🚫 Ce qui est INTERDIT

| Action | Pourquoi c'est interdit |
|--------|------------------------|
| `Read` sans `rag:context` avant | Gaspillage de tokens, contexte non pertinent |
| `Glob("**/*.ts")` pour chercher | Le RAG trouve plus vite et mieux |
| Lire des fichiers .md en entier | Utiliser RAG pour trouver les sections |
| `git push` sans demander | Risque de push non voulu |
| Modifier sans comprendre l'impact | Utiliser `rag:deps --impact` |

---

## 🏗️ Architecture du Toolkit

```
src/
├── cli.ts              # CLI indexation
├── search.ts           # CLI recherche (toutes les commandes)
├── scanner.ts          # Scan fichiers
├── chunker.ts          # Chunking (coordonne AST + regex)
├── ast-chunker.ts      # Parsing AST (ts-morph)
├── embedder.ts         # Embeddings (all-MiniLM-L6-v2)
├── store.ts            # Vector store
├── cache.ts            # Cache sémantique
├── diff-context.ts     # Parsing git diff
├── memory.ts           # Mémoire projet
├── prompt-templates.ts # Templates de prompts
├── dependency-graph.ts # Graphe imports/exports
├── file-watcher.ts     # Réindexation incrémentale
├── smart-context.ts    # Types-only, tests, sélection intelligente
└── auto-commit.ts      # Génération messages commit
```

## 📁 Fichiers Générés

| Fichier | Description | .gitignore |
|---------|-------------|------------|
| `.rag-index.json` | Index vectoriel | ✅ |
| `.rag-cache.json` | Cache requêtes | ✅ |
| `.rag-deps.json` | Graphe dépendances | ✅ |
| `.rag-hashes.json` | Hashes fichiers | ✅ |
| `.claude-memory.json` | Mémoire projet | ✅ |
| `.rag-session.json` | État session | ✅ |
| `.rag-errors.json` | DB erreurs | ✅ |
| `.rag-snippets.json` | Cache snippets | ✅ |

## 🏗️ Hooks (dans ~/.claude/hooks/)

| Fichier | Déclencheur | Fonction |
|---------|-------------|----------|
| `session-start.js` | SessionStart | Charge contexte au démarrage |
| `session-end.js` | Stop | Sauvegarde session à la fin |
| `smart-files.js` | PreToolUse (Edit) | Affiche fichiers liés |
| `auto-fix.js` | PostToolUse (Bash) | Suggère fix sur erreur |
| `suggest-rag.js` | PreToolUse (Read) | Rappelle RAG |

---

**⚠️ RESPECTER CES RÈGLES EST OBLIGATOIRE**

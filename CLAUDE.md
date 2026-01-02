# Claude Toolkit v5.0 - Instructions OBLIGATOIRES

## 📍 Exécution des commandes

**Toutes les commandes `pnpm rag:*` doivent être exécutées depuis le dossier du toolkit:**
```bash
cd plugins/claude-code-toolkit && pnpm rag:context "query" --lazy
```

---

## 🔄 WORKFLOW OBLIGATOIRE - À SUIVRE SYSTÉMATIQUEMENT

```
1. CHERCHER   → pnpm rag:context "query" --lazy --no-cache
2. EXAMINER   → pnpm rag:expand <path:line> -c 10
3. SI COMPLEXE → pnpm rag:hypothesis start --task "..."
4. VERROUILLER → pnpm rag:context-lock lock --reason "..."
5. MODIFIER   → Edit avec précision
6. COMMIT     → pnpm rag:commit -y
```

---

## ⚡ ÉCONOMIE TOKENS - UTILISATION OBLIGATOIRE

| Situation | Commande OBLIGATOIRE | Économie |
|-----------|---------------------|----------|
| Chercher du code | `pnpm rag:context "query" --lazy --no-cache` | **60-80%** |
| Puis charger un résultat | `pnpm rag:expand <ref> -c 10` | Seulement ce qu'il faut |
| Comprendre les types | `pnpm rag:context "query" --types-only` | **80-90%** |
| Explorer signatures | `pnpm rag:context "query" --signatures-only` | **70-80%** |

**⛔ INTERDIT:** `rag:context` sans `--lazy --no-cache` ou `--types-only` sauf besoin explicite du code complet.

---

## 🔧 READ OPTIMIZER (v5.0) - 8 Nouvelles Features

### 1. Budget Manager - Gestion des tokens
```bash
pnpm rag:budget init --limit 50000   # Initialiser budget session
pnpm rag:budget                       # Voir consommation
pnpm rag:budget increase --add 10000 --reason "Need more context"
```
**Économie: 40-60%** - Force à réfléchir avant chaque lecture

### 2. Hypothesis-Driven Reading - Lecture par hypothèses
```bash
pnpm rag:hypothesis start --task "Debug le bug X"
pnpm rag:hypothesis add --desc "Bug dans le parser" --files "src/parser.ts"
pnpm rag:hypothesis validate --id abc123 --evidence "Trouvé ligne 42"
pnpm rag:hypothesis                   # Voir status
```
**Économie: 50-70%** - Ne lit que les fichiers qui valident une hypothèse

### 3. Context Refusal Mode - Verrouillage du contexte
```bash
pnpm rag:context-lock lock --reason "Contexte suffisant pour ce bug"
pnpm rag:context-lock unlock
pnpm rag:context-lock override --file src/critical.ts
```
**Économie: 30-50%** - Bloque les lectures inutiles une fois le contexte acquis

### 4. Runtime Path Pruning - Analyse stack trace
```bash
pnpm rag:prune-path --stack "Error: ...\n    at foo (src/a.ts:10)"
pnpm rag:prune-path --file error.log
```
**Économie: 30-60%** - Élimine les fichiers hors du chemin d'exécution

### 5. API Contract Snapshot - Détection des changements d'API
```bash
pnpm rag:contracts snapshot           # Capturer toutes les signatures
pnpm rag:contracts snapshot -f file.ts
pnpm rag:contracts check -f file.ts   # Vérifier si API a changé
```
**Économie: 40-70%** - Évite de relire si les signatures sont inchangées

### 6. Error Locality Score - Score de pertinence
```bash
pnpm rag:locality                     # Scorer tous les fichiers
pnpm rag:locality src/file.ts         # Score d'un fichier
```
**Score basé sur:** récence, proximité diff, historique erreurs, centralité

### 7. Top-K Importance Index - Fichiers les plus importants
```bash
pnpm rag:importance build             # Construire l'index
pnpm rag:importance check -f file.ts  # Vérifier si fichier est important
pnpm rag:importance                   # Voir top fichiers
```
**Économie: 30-50%** - Focus sur les fichiers critiques

### 8. Risk-Weighted Review - Évaluation des risques
```bash
pnpm rag:risk src/auth.ts             # Évaluer un fichier
pnpm rag:risk --diff                  # Évaluer les fichiers modifiés
```
**Catégories:** security, performance, complexity, external, dataHandling

### Status unifié de l'optimiseur
```bash
pnpm rag:optimizer                    # Voir status complet
pnpm rag:optimizer -f file.ts         # Vérifier si lecture autorisée
```

---

## 🔌 Hooks Installés (v5.0 - Automatiques)

| Hook | Déclencheur | Action |
|------|-------------|--------|
| **session-start** | SessionStart | **Auto:** deps graph, importance index, budget init (50k), optimizer status |
| **session-end** | Stop | **Auto:** budget stats, hypothesis archive, context-lock reset |
| **smart-files** | PreToolUse (Edit) | Affiche fichiers liés (importers/imports) |
| **auto-fix** | PostToolUse (Bash) | Cherche erreur dans DB + suggère fix |
| **auto-truncate** | PostToolUse (Read) | Tronque fichiers >150 lignes |
| **read-guard** | PreToolUse (Read) | **Vérifie budget + optimizer avant lecture** |
| **budget-tracker** | PostToolUse (Read) | **Enregistre consommation tokens** |

### Ce qui est AUTOMATIQUE au démarrage de session:
```
✅ pnpm rag:deps --build         (si .rag/deps.json manquant)
✅ pnpm rag:importance build     (si .rag/importance.json manquant)
✅ pnpm rag:budget init --limit 50000  (si .rag/budget.json manquant)
✅ pnpm rag:optimizer            (affiche status unifié)
✅ Charge hypotheses actives     (si .rag/hypothesis.json existe)
```

### Ce qui est AUTOMATIQUE en fin de session:
```
✅ Sauvegarde budget stats dans session
✅ Archive hypothèses terminées (0 pending)
✅ Reset context-lock (supprime .rag/context-state.json)
✅ Sauvegarde session complète
```

---

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

### 5. TOUJOURS utiliser le budget (v5.0)
```
✅ OBLIGATOIRE : pnpm rag:budget init en début de session complexe
✅ OBLIGATOIRE : pnpm rag:optimizer -f file.ts avant lecture importante
```

---

## 📋 Commandes Disponibles

### Recherche & Contexte
| Commande | Usage | Économie |
|----------|-------|----------|
| `pnpm rag:context "q" --lazy` | Recherche avec refs seulement | **60-80%** |
| `pnpm rag:context "q" --types-only` | Types/interfaces seulement | **80-90%** |
| `pnpm rag:context "q" --signatures-only` | Signatures uniquement | **70-80%** |
| `pnpm rag:context "q" --smart` | Sélection intelligente auto | 50-70% |
| `pnpm rag:expand <ref> -c N` | Charger N lignes autour d'une ref | Précis |

### Git & Diff
| Commande | Usage |
|----------|-------|
| `pnpm rag:diff --summary` | Résumé rapide des changements |
| `pnpm rag:commit --dry-run` | Prévisualiser le message commit |
| `pnpm rag:commit -y` | Commiter directement |

### Dépendances
| Commande | Usage |
|----------|-------|
| `pnpm rag:deps <file> --impact` | Analyse d'impact avant refactor |
| `pnpm rag:deps --dead-exports` | Trouver code mort |

### Read Optimizer (v5.0)
| Commande | Usage | Économie |
|----------|-------|----------|
| `pnpm rag:budget` | Voir/gérer budget tokens | **40-60%** |
| `pnpm rag:hypothesis` | Gérer session par hypothèses | **50-70%** |
| `pnpm rag:context-lock` | Verrouiller contexte | **30-50%** |
| `pnpm rag:contracts` | Snapshots API | **40-70%** |
| `pnpm rag:locality` | Scores de pertinence | Prioritise |
| `pnpm rag:importance` | Index d'importance | **30-50%** |
| `pnpm rag:risk` | Évaluation risques | Focus sécu |
| `pnpm rag:optimizer` | Status unifié | Vue globale |

### Session & Mémoire
| Commande | Usage |
|----------|-------|
| `pnpm rag:session` | Résumé session actuelle |
| `pnpm rag:memory` | Contexte projet |
| `pnpm rag:errors find -m "msg"` | Chercher erreur connue |
| `pnpm rag:snippets --search "q"` | Chercher snippet |

---

## 🎯 Workflows Recommandés

### Debug avec Budget (Nouveau v5.0)
```bash
# 1. Initialiser budget
pnpm rag:budget init --limit 30000

# 2. Démarrer session hypothèses
pnpm rag:hypothesis start --task "Fix bug TypeError in parser"
pnpm rag:hypothesis add --desc "Problème dans tokenizer" --files "src/tokenizer.ts"

# 3. Chercher avec RAG
pnpm rag:context "tokenizer error handling" --lazy

# 4. Valider hypothèse si trouvé
pnpm rag:hypothesis validate --id xxx --evidence "Ligne 42 ne gère pas null"

# 5. Verrouiller contexte si suffisant
pnpm rag:context-lock lock --reason "Trouvé le bug, contexte suffisant"

# 6. Corriger et commiter
pnpm rag:commit -y
```

### Refactor Safe (Nouveau v5.0)
```bash
# 1. Capturer état actuel des APIs
pnpm rag:contracts snapshot

# 2. Analyser impact
pnpm rag:deps src/file.ts --impact

# 3. Évaluer risques
pnpm rag:risk src/file.ts

# 4. Refactorer...

# 5. Vérifier que les APIs n'ont pas changé
pnpm rag:contracts check -f src/file.ts
```

---

## 📁 Fichiers Générés

Tous les fichiers sont stockés dans le dossier `.rag/` (ajouter au .gitignore):

| Fichier | Description |
|---------|-------------|
| `.rag/index.json` | Index vectoriel |
| `.rag/cache.json` | Cache requêtes |
| `.rag/deps.json` | Graphe dépendances |
| `.rag/hashes.json` | Hash des fichiers |
| `.rag/budget.json` | Budget tokens session |
| `.rag/hypothesis.json` | Session hypothèses actives |
| `.rag/hypothesis-archive.json` | Archive hypothèses terminées |
| `.rag/context-state.json` | État context lock |
| `.rag/contracts.json` | Snapshots API |
| `.rag/importance.json` | Index importance |
| `.rag/session.json` | État session |
| `.rag/errors.json` | DB erreurs |
| `.rag/snippets.json` | Cache snippets |
| `.rag/memory.json` | Mémoire projet |

---

**⚠️ RESPECTER CES RÈGLES EST OBLIGATOIRE**

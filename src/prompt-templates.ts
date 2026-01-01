/**
 * Prompt Templates - Predefined optimized prompts for common tasks
 *
 * Provides token-efficient templates for:
 * - Code review
 * - Debugging
 * - Refactoring
 * - Explaining code
 * - Writing tests
 * - Documentation
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: "review" | "debug" | "refactor" | "explain" | "test" | "docs" | "implement";
  template: string;
  variables: string[];
  estimatedTokens: number;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // Code Review Templates
  {
    id: "review-quick",
    name: "Quick Review",
    description: "Fast code review focusing on critical issues",
    category: "review",
    template: `Review this code for:
1. Bugs/errors
2. Security issues
3. Performance problems

{{code}}

Reply with: issues found (severity: high/med/low) + fix suggestions.`,
    variables: ["code"],
    estimatedTokens: 50,
  },
  {
    id: "review-full",
    name: "Full Review",
    description: "Comprehensive code review",
    category: "review",
    template: `Full code review for:

{{code}}

Check:
- [ ] Logic errors
- [ ] Security vulnerabilities
- [ ] Performance issues
- [ ] Code style/conventions
- [ ] Error handling
- [ ] Edge cases

Format: Issue | Severity | Line | Suggestion`,
    variables: ["code"],
    estimatedTokens: 80,
  },
  {
    id: "review-pr",
    name: "PR Review",
    description: "Review pull request changes",
    category: "review",
    template: `Review these PR changes:

{{diff}}

Focus on:
1. Breaking changes
2. Missing tests
3. Potential bugs
4. Suggestions for improvement

Format: file:line - issue - suggestion`,
    variables: ["diff"],
    estimatedTokens: 60,
  },

  // Debug Templates
  {
    id: "debug-error",
    name: "Debug Error",
    description: "Debug a specific error message",
    category: "debug",
    template: `Debug this error:

Error: {{error}}

Context:
{{code}}

Analyze:
1. Root cause
2. Fix
3. Prevention`,
    variables: ["error", "code"],
    estimatedTokens: 45,
  },
  {
    id: "debug-behavior",
    name: "Debug Behavior",
    description: "Debug unexpected behavior",
    category: "debug",
    template: `Expected: {{expected}}
Actual: {{actual}}

Code:
{{code}}

Find the bug and fix it.`,
    variables: ["expected", "actual", "code"],
    estimatedTokens: 35,
  },
  {
    id: "debug-performance",
    name: "Debug Performance",
    description: "Identify performance bottlenecks",
    category: "debug",
    template: `Performance issue in:

{{code}}

Identify bottlenecks and optimize. Show before/after.`,
    variables: ["code"],
    estimatedTokens: 30,
  },

  // Refactor Templates
  {
    id: "refactor-extract",
    name: "Extract Function",
    description: "Extract code into reusable function",
    category: "refactor",
    template: `Extract this into a reusable function:

{{code}}

Requirements:
- Pure function if possible
- TypeScript with proper types
- JSDoc comment`,
    variables: ["code"],
    estimatedTokens: 40,
  },
  {
    id: "refactor-simplify",
    name: "Simplify Code",
    description: "Simplify complex code",
    category: "refactor",
    template: `Simplify this code while keeping behavior:

{{code}}

Goals: readability, fewer lines, better naming.`,
    variables: ["code"],
    estimatedTokens: 30,
  },
  {
    id: "refactor-patterns",
    name: "Apply Patterns",
    description: "Apply design patterns",
    category: "refactor",
    template: `Refactor using appropriate design patterns:

{{code}}

Suggest patterns that would improve this code and show implementation.`,
    variables: ["code"],
    estimatedTokens: 35,
  },
  {
    id: "refactor-split",
    name: "Split Component",
    description: "Split large component into smaller ones",
    category: "refactor",
    template: `Split this component into smaller, focused components:

{{code}}

Each component should:
- Have single responsibility
- Be reusable
- Have proper types`,
    variables: ["code"],
    estimatedTokens: 45,
  },

  // Explain Templates
  {
    id: "explain-code",
    name: "Explain Code",
    description: "Explain what code does",
    category: "explain",
    template: `Explain this code briefly:

{{code}}

Format:
- Purpose: (1 sentence)
- How: (bullet points)
- Key concepts: (list)`,
    variables: ["code"],
    estimatedTokens: 40,
  },
  {
    id: "explain-architecture",
    name: "Explain Architecture",
    description: "Explain architectural decisions",
    category: "explain",
    template: `Explain the architecture of:

{{code}}

Cover:
- Design patterns used
- Data flow
- Component relationships
- Trade-offs made`,
    variables: ["code"],
    estimatedTokens: 45,
  },
  {
    id: "explain-flow",
    name: "Explain Flow",
    description: "Explain execution flow",
    category: "explain",
    template: `Trace the execution flow:

{{code}}

Show step-by-step what happens when this runs.`,
    variables: ["code"],
    estimatedTokens: 30,
  },

  // Test Templates
  {
    id: "test-unit",
    name: "Generate Unit Tests",
    description: "Generate unit tests for a function",
    category: "test",
    template: `Generate unit tests for:

{{code}}

Include:
- Happy path
- Edge cases
- Error cases

Use: {{framework}}`,
    variables: ["code", "framework"],
    estimatedTokens: 45,
  },
  {
    id: "test-integration",
    name: "Generate Integration Tests",
    description: "Generate integration tests",
    category: "test",
    template: `Generate integration tests for:

{{code}}

Test interactions between components. Use {{framework}}.`,
    variables: ["code", "framework"],
    estimatedTokens: 35,
  },
  {
    id: "test-cases",
    name: "List Test Cases",
    description: "List test cases without implementation",
    category: "test",
    template: `List all test cases needed for:

{{code}}

Format: describe > it > assertion (no code, just descriptions)`,
    variables: ["code"],
    estimatedTokens: 30,
  },

  // Docs Templates
  {
    id: "docs-jsdoc",
    name: "Generate JSDoc",
    description: "Generate JSDoc comments",
    category: "docs",
    template: `Add JSDoc comments to:

{{code}}

Include: @param, @returns, @throws, @example`,
    variables: ["code"],
    estimatedTokens: 30,
  },
  {
    id: "docs-readme",
    name: "Generate README Section",
    description: "Generate README documentation",
    category: "docs",
    template: `Generate README section for:

{{code}}

Include: description, installation, usage example, API reference.`,
    variables: ["code"],
    estimatedTokens: 35,
  },
  {
    id: "docs-api",
    name: "Generate API Docs",
    description: "Generate API documentation",
    category: "docs",
    template: `Generate API documentation for:

{{code}}

Format: markdown table with method, params, returns, description.`,
    variables: ["code"],
    estimatedTokens: 35,
  },

  // Implementation Templates
  {
    id: "impl-feature",
    name: "Implement Feature",
    description: "Implement a new feature",
    category: "implement",
    template: `Implement: {{feature}}

Context:
{{context}}

Requirements:
- TypeScript strict mode
- Follow existing patterns
- Add types
- Handle errors`,
    variables: ["feature", "context"],
    estimatedTokens: 45,
  },
  {
    id: "impl-interface",
    name: "Implement Interface",
    description: "Implement an interface/type",
    category: "implement",
    template: `Implement this interface:

{{interface}}

Add all required methods with proper error handling.`,
    variables: ["interface"],
    estimatedTokens: 30,
  },
  {
    id: "impl-migration",
    name: "Migration Script",
    description: "Generate migration script",
    category: "implement",
    template: `Create migration from:

Before:
{{before}}

After:
{{after}}

Generate script to migrate existing data/code.`,
    variables: ["before", "after"],
    estimatedTokens: 40,
  },
];

/**
 * Get template by ID
 */
export function getTemplate(id: string): PromptTemplate | undefined {
  return PROMPT_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: PromptTemplate["category"]): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => t.category === category);
}

/**
 * List all templates
 */
export function listTemplates(): { id: string; name: string; category: string; description: string }[] {
  return PROMPT_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
  }));
}

/**
 * Fill template with variables
 */
export function fillTemplate(template: PromptTemplate, variables: Record<string, string>): string {
  let result = template.template;

  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }

  // Check for unfilled variables
  const unfilled = result.match(/{{(\w+)}}/g);
  if (unfilled) {
    const missing = unfilled.map((v) => v.slice(2, -2));
    throw new Error(`Missing variables: ${missing.join(", ")}`);
  }

  return result;
}

/**
 * Search templates by keyword
 */
export function searchTemplates(query: string): PromptTemplate[] {
  const lowerQuery = query.toLowerCase();
  return PROMPT_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.id.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get suggested templates for a task description
 */
export function suggestTemplates(taskDescription: string): PromptTemplate[] {
  const lower = taskDescription.toLowerCase();

  const keywords: Record<string, PromptTemplate["category"][]> = {
    review: ["review"],
    pr: ["review"],
    check: ["review"],
    bug: ["debug"],
    error: ["debug"],
    fix: ["debug"],
    debug: ["debug"],
    crash: ["debug"],
    slow: ["debug"],
    performance: ["debug"],
    refactor: ["refactor"],
    clean: ["refactor"],
    simplify: ["refactor"],
    extract: ["refactor"],
    split: ["refactor"],
    explain: ["explain"],
    understand: ["explain"],
    "what does": ["explain"],
    how: ["explain"],
    test: ["test"],
    spec: ["test"],
    coverage: ["test"],
    doc: ["docs"],
    readme: ["docs"],
    jsdoc: ["docs"],
    comment: ["docs"],
    implement: ["implement"],
    add: ["implement"],
    create: ["implement"],
    build: ["implement"],
  };

  const matchedCategories = new Set<PromptTemplate["category"]>();

  for (const [keyword, categories] of Object.entries(keywords)) {
    if (lower.includes(keyword)) {
      for (const cat of categories) {
        matchedCategories.add(cat);
      }
    }
  }

  if (matchedCategories.size === 0) {
    return [];
  }

  return PROMPT_TEMPLATES.filter((t) => matchedCategories.has(t.category)).slice(0, 5);
}

/**
 * Format template for display
 */
export function formatTemplate(template: PromptTemplate): string {
  let output = `\n📝 ${template.name} (${template.id})\n`;
  output += `   Category: ${template.category}\n`;
  output += `   ${template.description}\n`;
  output += `   Variables: ${template.variables.join(", ")}\n`;
  output += `   Est. tokens: ~${template.estimatedTokens}\n`;
  output += `\n   Template:\n`;
  output += template.template
    .split("\n")
    .map((l) => `   │ ${l}`)
    .join("\n");
  output += "\n";
  return output;
}

/**
 * Format template list for display
 */
export function formatTemplateList(templates: PromptTemplate[]): string {
  const byCategory = new Map<string, PromptTemplate[]>();

  for (const t of templates) {
    const existing = byCategory.get(t.category) || [];
    existing.push(t);
    byCategory.set(t.category, existing);
  }

  let output = "\n📋 Available Prompt Templates\n\n";

  const categoryIcons: Record<string, string> = {
    review: "🔍",
    debug: "🐛",
    refactor: "♻️",
    explain: "💡",
    test: "🧪",
    docs: "📄",
    implement: "🔧",
  };

  for (const [category, temps] of byCategory) {
    output += `${categoryIcons[category] || "📌"} ${category.toUpperCase()}\n`;
    for (const t of temps) {
      output += `   ${t.id.padEnd(20)} ${t.name.padEnd(25)} (~${t.estimatedTokens} tokens)\n`;
    }
    output += "\n";
  }

  output += `Use: pnpm rag:template <id> --var1="value" --var2="value"\n`;
  return output;
}

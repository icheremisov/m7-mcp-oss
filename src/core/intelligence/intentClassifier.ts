import { createLogger } from '../utils/logger.js';
const log = createLogger('[intentClassifier]');
/**
 * M7 v3.5 - LLM Intent Classifier with Pattern Selection
 * 
 * Fork: классификация через jev (OpenCode Zen System One, вероятности по вопросам),
 * фолбэк — opencode run с моделью роли "classifier", затем getDefaultIntent().
 * M7_CLASSIFIER=jev|opencode|off выбирает первый способ.
 * 
 * v3.5: LLM сам выбирает patternsToScan и fileExtensions из списка доступных.
 * 
 * @author M7 AI Assistant
 * @version 3.5.0
 * @date 2026-01-22
 */

import { z } from 'zod';
import { askJev, argmax, completeForRole, JevQuestion } from '../../llm/index.js';
import { robustParse } from '../../hive/utils/json/index.js';

// ============================================
// TYPES
// ============================================

export type Intent = 
  | 'LOGS'      // Проверить логи, подготовить отчёт
  | 'EXPLAIN'   // Объяснить, уточнить (без кода)
  | 'DIAGNOSE'  // Изучить, диагностировать проблему
  | 'DISCUSS'   // Продолжить обсуждение
  | 'PLAN'      // Подготовить план, архитектуру (без кода)
  | 'DOCS'      // Создать документацию
  | 'FIX'       // Исправить баг
  | 'IMPLEMENT' // Реализовать фичу
  | 'DEPLOY';   // Деплой на прод

export type Phase = 'DISCOVERY' | 'PLANNING' | 'IMPLEMENTATION' | 'DEPLOYMENT';

export type Route = 'light' | 'medium' | 'heavy' | 'decompose';

export type AgentType = 'research' | 'implementation' | 'architecture' | 
                        'security' | 'testing' | 'performance';

// ============================================
// AVAILABLE SCAN PATTERNS (v3.5)
// ============================================

export const AVAILABLE_PATTERNS = [
  'console-logs',           // console.log/warn/error/debug
  'todo-comments',          // TODO/FIXME/HACK/XXX
  'magic-numbers',          // Magic numbers in code
  'php7-to-php8',           // PHP7 → PHP8 migration
  'php-legacy',             // Legacy PHP patterns
  'commonjs-to-esm',        // CommonJS → ESM
  'var-to-const-let',       // var → const/let
  'callback-to-promise',    // Callbacks → async/await
  'javascript-to-typescript', // JS → TS migration
  'any-types',              // any type usage in TS
  'react-class-to-hooks',   // Class → Functional components
  'react-deprecated',       // Deprecated React APIs
  'react-string-refs',      // String refs → useRef
  'python2-to-python3',     // Python 2 → Python 3
  'css-vendor-prefixes',    // CSS vendor prefixes
  'sql-injection-risk',     // SQL injection patterns
] as const;

export type ScanPatternId = typeof AVAILABLE_PATTERNS[number];

// ============================================
// ZOD SCHEMA
// ============================================

export const ClassifiedIntentSchema = z.object({
  intent: z.enum(['LOGS', 'EXPLAIN', 'DIAGNOSE', 'DISCUSS', 'PLAN', 'DOCS', 'FIX', 'IMPLEMENT', 'DEPLOY']),
  phase: z.enum(['DISCOVERY', 'PLANNING', 'IMPLEMENTATION', 'DEPLOYMENT']),
  route: z.enum(['light', 'medium', 'heavy', 'decompose']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  allowCode: z.boolean(),
  suggestedAgents: z.array(z.enum(['research', 'implementation', 'architecture', 'security', 'testing', 'performance'])),
  estimatedFiles: z.number().int().min(0),
  estimatedMinutes: z.number().int().min(0),
  risks: z.array(z.string()),
  requiresFullCycle: z.boolean(),
  // v3.5: LLM выбирает паттерны для сканирования
  patternsToScan: z.array(z.enum([
    'console-logs', 'todo-comments', 'magic-numbers',
    'php7-to-php8', 'php-legacy',
    'commonjs-to-esm', 'var-to-const-let', 'callback-to-promise',
    'javascript-to-typescript', 'any-types',
    'react-class-to-hooks', 'react-deprecated', 'react-string-refs',
    'python2-to-python3', 'css-vendor-prefixes', 'sql-injection-risk'
  ])),
  fileExtensions: z.array(z.string()),
});

export type ClassifiedIntent = z.infer<typeof ClassifiedIntentSchema>;

// ============================================
// BACKWARDS COMPATIBILITY (for router.ts)
// ============================================

export interface DetectedIntent {
  intent: Intent;
  confidence: number;
  phase: Phase;
  allowCode: boolean;
  fullCycle: boolean;
  safetyCheck: boolean;
  aiCodingSafety: boolean;
  context7: boolean;
  grepFirst: boolean;
  matchedKeywords: string[];
  recommendedRoute: Route;
  // v3.5: LLM-selected patterns for scanning
  patternsToScan: ScanPatternId[];
  fileExtensions: string[];
}

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `Ты M7 Intent Classifier. Анализируй задачу пользователя и возвращай структурированный JSON.

## ИНТЕНТЫ:

| Intent | Описание | allowCode | Типичный route |
|--------|----------|-----------|----------------|
| LOGS | Проверить логи, подготовить отчёт | false | medium |
| EXPLAIN | Объяснить, уточнить что-то | false | light |
| DIAGNOSE | Изучить, диагностировать проблему | false | medium |
| DISCUSS | Продолжить обсуждение, уточнение | false | light |
| PLAN | Подготовить план, архитектуру | false | medium |
| DOCS | Создать или обновить документацию | false | medium |
| FIX | Исправить баг, ошибку | true | medium |
| IMPLEMENT | Реализовать фичу, написать код | true | medium |
| DEPLOY | Деплой на прод, релиз | true | heavy |

## ROUTES:

| Route | Файлов | Когда использовать |
|-------|--------|-------------------|
| light | 1-3 | Простые изменения: typo, rename, добавить import |
| medium | 3-10 | Новые фичи, рефакторинг, исправление багов |
| heavy | 10+ | Архитектурные изменения, новые системы, большой рефакторинг |
| decompose | много | Задача слишком большая, нужно разбить на подзадачи |

## AGENTS:

| Agent | Когда добавить |
|-------|---------------|
| research | Нужно изучить best practices, документацию |
| implementation | Нужно писать код |
| architecture | Архитектурные решения, дизайн системы |
| security | Работа с auth, permissions, sensitive data |
| testing | Нужны тесты, QA |
| performance | Оптимизация, метрики производительности |

## ДОСТУПНЫЕ ПАТТЕРНЫ ДЛЯ СКАНИРОВАНИЯ (patternsToScan):

| Pattern ID | Что ищет | Расширения |
|------------|----------|------------|
| console-logs | console.log/warn/error/debug/info | .js, .ts, .jsx, .tsx |
| todo-comments | TODO/FIXME/HACK/XXX комментарии | все |
| magic-numbers | Магические числа в коде | .js, .ts, .jsx, .tsx |
| php7-to-php8 | array(), mysql_*, each(), etc. | .php |
| php-legacy | Legacy PHP: $GLOBALS, global, extract | .php |
| commonjs-to-esm | require(), module.exports | .js, .cjs |
| var-to-const-let | var declarations | .js, .jsx |
| callback-to-promise | Callback patterns | .js, .ts, .jsx, .tsx |
| javascript-to-typescript | PropTypes, JSDoc, untyped functions | .js, .jsx |
| any-types | any type usage | .ts, .tsx |
| react-class-to-hooks | Class components, lifecycle methods | .jsx, .tsx, .js, .ts |
| react-deprecated | Deprecated React APIs | .jsx, .tsx, .js, .ts |
| react-string-refs | String refs, this.refs | .jsx, .tsx, .js, .ts |
| python2-to-python3 | print, xrange, iteritems | .py |
| css-vendor-prefixes | -webkit-, -moz-, etc. | .css, .scss, .less |
| sql-injection-risk | SQL injection patterns | .php, .js, .ts, .py |

## ПРАВИЛА КЛАССИФИКАЦИИ:

1. **Если задача упоминает:** "архитектуру", "систему", "переделать всё", "с нуля" → route: heavy
2. **Если задача упоминает:** "исправь", "починить", "баг", "ошибка" → intent: FIX
3. **Если явно просят:** "без кода", "только план", "не пиши код" → allowCode: false
4. **Если задача простая:** rename, typo, добавить import → route: light
5. **confidence** должен отражать твою реальную уверенность в классификации
6. **requiresFullCycle = true** если задача сложная, рискованная, или затрагивает много файлов
7. **suggestedAgents** — добавляй всех релевантных агентов для задачи
8. **risks** — перечисли потенциальные риски выполнения задачи
9. **estimatedFiles** — сколько файлов примерно будет затронуто
10. **estimatedMinutes** — сколько минут займёт выполнение
11. **patternsToScan** — ВЫБЕРИ паттерны из таблицы выше, которые релевантны для задачи. Пустой массив [] если не нужно сканирование.
12. **fileExtensions** — укажи расширения файлов для поиска (например [".ts", ".tsx"]). Пустой массив [] если не нужно сканирование.

## ПРИМЕРЫ:

Задача: "исправь баг в auth модуле"
→ intent: FIX, route: medium, patternsToScan: [], fileExtensions: []

Задача: "рефакторни все console.log на proper logging"
→ intent: FIX, route: medium, patternsToScan: ["console-logs"], fileExtensions: [".ts", ".js", ".tsx", ".jsx"]

Задача: "переведи проект с PHP7 на PHP8"
→ intent: IMPLEMENT, route: heavy, patternsToScan: ["php7-to-php8", "php-legacy"], fileExtensions: [".php"]

Задача: "конвертируй React классы в хуки"
→ intent: IMPLEMENT, route: heavy, patternsToScan: ["react-class-to-hooks", "react-deprecated"], fileExtensions: [".jsx", ".tsx"]

Задача: "объясни как работает auth"
→ intent: EXPLAIN, route: light, allowCode: false, patternsToScan: [], fileExtensions: []`;

// ============================================
// JEV QUESTIONS (fork)
// ============================================

const JEV_THRESHOLD = 0.5;
const AGENT_TYPES: AgentType[] = ['research', 'implementation', 'architecture', 'security', 'testing', 'performance'];

const INTENT_PHASE: Record<Intent, Phase> = {
  LOGS: 'DISCOVERY', EXPLAIN: 'DISCOVERY', DIAGNOSE: 'DISCOVERY', DISCUSS: 'DISCOVERY',
  PLAN: 'PLANNING', DOCS: 'PLANNING', FIX: 'IMPLEMENTATION', IMPLEMENT: 'IMPLEMENTATION', DEPLOY: 'DEPLOYMENT',
};

const ROUTE_ESTIMATES: Record<Route, { files: number; minutes: number }> = {
  light: { files: 2, minutes: 15 },
  medium: { files: 6, minutes: 60 },
  heavy: { files: 15, minutes: 240 },
  decompose: { files: 30, minutes: 480 },
};

const PATTERN_EXTENSIONS: Record<ScanPatternId, string[]> = {
  'console-logs': ['.js', '.ts', '.jsx', '.tsx'],
  'todo-comments': ['.ts', '.tsx', '.js', '.jsx', '.py', '.php', '.go', '.rs', '.java', '.cs', '.dart'],
  'magic-numbers': ['.js', '.ts', '.jsx', '.tsx'],
  'php7-to-php8': ['.php'],
  'php-legacy': ['.php'],
  'commonjs-to-esm': ['.js', '.cjs'],
  'var-to-const-let': ['.js', '.jsx'],
  'callback-to-promise': ['.js', '.ts', '.jsx', '.tsx'],
  'javascript-to-typescript': ['.js', '.jsx'],
  'any-types': ['.ts', '.tsx'],
  'react-class-to-hooks': ['.jsx', '.tsx', '.js', '.ts'],
  'react-deprecated': ['.jsx', '.tsx', '.js', '.ts'],
  'react-string-refs': ['.jsx', '.tsx', '.js', '.ts'],
  'python2-to-python3': ['.py'],
  'css-vendor-prefixes': ['.css', '.scss', '.less'],
  'sql-injection-risk': ['.php', '.js', '.ts', '.py'],
};

const PATTERN_QUESTIONS: Record<ScanPatternId, string> = {
  'console-logs': 'The task requires finding or replacing console.log/warn/error/debug calls in JS/TS code.',
  'todo-comments': 'The task requires finding TODO/FIXME/HACK comments in the code.',
  'magic-numbers': 'The task is about replacing magic numbers with named constants.',
  'php7-to-php8': 'The task is a PHP 7 to PHP 8 migration.',
  'php-legacy': 'The task is about cleaning up legacy PHP patterns (globals, extract).',
  'commonjs-to-esm': 'The task is a CommonJS (require/module.exports) to ES modules migration.',
  'var-to-const-let': 'The task is about replacing var declarations with const/let.',
  'callback-to-promise': 'The task is about converting callbacks to promises or async/await.',
  'javascript-to-typescript': 'The task is a JavaScript to TypeScript migration.',
  'any-types': 'The task is about removing or replacing `any` types in TypeScript.',
  'react-class-to-hooks': 'The task is converting React class components to function components with hooks.',
  'react-deprecated': 'The task is about replacing deprecated React APIs.',
  'react-string-refs': 'The task is about replacing React string refs with useRef/createRef.',
  'python2-to-python3': 'The task is a Python 2 to Python 3 migration.',
  'css-vendor-prefixes': 'The task is about CSS vendor prefixes (-webkit-, -moz-).',
  'sql-injection-risk': 'The task is about finding or fixing SQL injection risks.',
};

const JEV_QUESTIONS: Record<string, JevQuestion> = {
  intent: {
    type: 'choice',
    instructions: 'What does the user ask the coding agent to do?',
    criteria: {
      LOGS: 'check logs, prepare a report', EXPLAIN: 'explain or clarify something, no code changes',
      DIAGNOSE: 'investigate or diagnose a problem', DISCUSS: 'continue a discussion',
      PLAN: 'prepare a plan or architecture, no code', DOCS: 'write or update documentation',
      FIX: 'fix a bug or error', IMPLEMENT: 'implement a feature, refactor or write code',
      DEPLOY: 'deploy or release to production',
    },
  },
  route: {
    type: 'choice',
    instructions: 'How large is the change?',
    criteria: {
      light: '1-3 files: typo, rename, add an import', medium: '3-10 files: new feature, refactoring, bug fix',
      heavy: '10+ files: architecture change, new system, large refactoring',
      decompose: 'too large for one task, must be split into subtasks',
    },
  },
  allow_code: { type: 'noul', instructions: 'Completing the task requires writing or changing code (the user did not ask for "no code" / "only a plan").' },
  full_cycle: { type: 'noul', instructions: 'The task is complex or risky enough to need full discovery, design and impact analysis before coding.' },
  agent_research: { type: 'noul', instructions: 'The task needs research of documentation or best practices.' },
  agent_implementation: { type: 'noul', instructions: 'The task needs writing code.' },
  agent_architecture: { type: 'noul', instructions: 'The task involves architecture or system design decisions.' },
  agent_security: { type: 'noul', instructions: 'The task touches authentication, permissions, secrets or sensitive data.' },
  agent_testing: { type: 'noul', instructions: 'The task needs tests or QA.' },
  agent_performance: { type: 'noul', instructions: 'The task is about performance optimization or metrics.' },
  ...Object.fromEntries(Object.entries(PATTERN_QUESTIONS).map(([id, text]) =>
    [`pattern_${id}`, { type: 'noul', instructions: text } as JevQuestion])),
};


/** Fork: free-form models drift on enum case and omit fields — normalise before strict validation. */
function coerceClassified(raw: any): unknown {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
    const v = String(value ?? '').trim();
    return allowed.find(a => a.toLowerCase() === v.toLowerCase()) ?? fallback;
  };
  const list = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
    (Array.isArray(value) ? value : []).map(v => allowed.find(a => a.toLowerCase() === String(v).toLowerCase()))
      .filter((v): v is T => Boolean(v));
  const intent = pick(raw?.intent, Object.keys(INTENT_PHASE) as Intent[], 'EXPLAIN');
  const route = pick(raw?.route, ['light', 'medium', 'heavy', 'decompose'] as const, 'medium');
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : d);
  return {
    intent,
    phase: pick(raw?.phase, ['DISCOVERY', 'PLANNING', 'IMPLEMENTATION', 'DEPLOYMENT'] as const, INTENT_PHASE[intent]),
    route,
    confidence: Math.min(1, num(raw?.confidence, 0.5)),
    reasoning: String(raw?.reasoning ?? ''),
    allowCode: typeof raw?.allowCode === 'boolean' ? raw.allowCode : ['FIX', 'IMPLEMENT', 'DEPLOY'].includes(intent),
    suggestedAgents: list(raw?.suggestedAgents, AGENT_TYPES),
    estimatedFiles: Math.round(num(raw?.estimatedFiles, ROUTE_ESTIMATES[route].files)),
    estimatedMinutes: Math.round(num(raw?.estimatedMinutes, ROUTE_ESTIMATES[route].minutes)),
    risks: Array.isArray(raw?.risks) ? raw.risks.map(String) : [],
    requiresFullCycle: typeof raw?.requiresFullCycle === 'boolean' ? raw.requiresFullCycle : route !== 'light',
    patternsToScan: list(raw?.patternsToScan, AVAILABLE_PATTERNS),
    fileExtensions: Array.isArray(raw?.fileExtensions) ? raw.fileExtensions.map(String) : [],
  };
}

// ============================================
// CLASSIFIER CLASS
// ============================================

export class IntentClassifier {
  /**
   * Классифицировать задачу: jev → opencode → default
   */
  async classify(taskDescription: string): Promise<ClassifiedIntent> {
    const mode = (process.env.M7_CLASSIFIER || 'jev').toLowerCase();
    const startTime = Date.now();
    if (mode === 'off') return this.getDefaultIntent('Classifier disabled (M7_CLASSIFIER=off)');

    if (mode === 'jev') {
      try {
        const result = await this.classifyWithJev(taskDescription);
        log.debug(`IntentClassifier] jev ${Date.now() - startTime}ms: intent=${result.intent}, route=${result.route}`);
        return result;
      } catch (error: any) {
        log.debug(`IntentClassifier] jev failed: ${error.message} — falling back to opencode`);
      }
    }

    try {
      const result = await this.classifyWithOpencode(taskDescription);
      log.debug(`IntentClassifier] opencode ${Date.now() - startTime}ms: intent=${result.intent}, route=${result.route}`);
      return result;
    } catch (error: any) {
      log.debug(`IntentClassifier] opencode failed: ${error.message}`);
      return this.getDefaultIntent(error.message);
    }
  }

  private async classifyWithJev(taskDescription: string): Promise<ClassifiedIntent> {
    const answers = await askJev(`Developer task for a coding agent: ${taskDescription}`, JEV_QUESTIONS);
    const intentProbs = answers.intent as Record<string, number>;
    const routeProbs = answers.route as Record<string, number>;
    const [intent, intentP] = argmax(intentProbs);
    const [route] = argmax(routeProbs);
    const yes = (q: string) => (answers[q] as number) >= JEV_THRESHOLD;

    const suggestedAgents = AGENT_TYPES.filter(a => yes(`agent_${a}`));
    const patternsToScan = AVAILABLE_PATTERNS.filter(p => yes(`pattern_${p}`));
    const fileExtensions = [...new Set(patternsToScan.flatMap(p => PATTERN_EXTENSIONS[p]))];
    const allowCode = yes('allow_code');
    const requiresFullCycle = yes('full_cycle') || route === 'heavy' || route === 'decompose';
    const risks: string[] = [];
    if (yes('agent_security')) risks.push('Затрагивает авторизацию, права или чувствительные данные');
    if (route === 'heavy' || route === 'decompose') risks.push('Крупное изменение: высокий риск регрессий');
    if (intent === 'DEPLOY') risks.push('Изменение продакшена');
    if (intentP < 0.6) risks.push('Неуверенная классификация интента');

    const top = Object.entries(intentProbs).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ');
    return ClassifiedIntentSchema.parse({
      intent,
      phase: INTENT_PHASE[intent as Intent],
      route,
      confidence: intentP,
      reasoning: `jev: ${top}; route ${route}`,
      allowCode,
      suggestedAgents: suggestedAgents.length ? suggestedAgents : ['research'],
      estimatedFiles: ROUTE_ESTIMATES[route as Route].files,
      estimatedMinutes: ROUTE_ESTIMATES[route as Route].minutes,
      risks,
      requiresFullCycle,
      patternsToScan,
      fileExtensions,
    });
  }

  private async classifyWithOpencode(taskDescription: string): Promise<ClassifiedIntent> {
    const result = await completeForRole({
      role: 'classifier',
      system: `${SYSTEM_PROMPT}\n\nВерни ТОЛЬКО JSON-объект со всеми полями: intent, phase, route, confidence, reasoning, allowCode, suggestedAgents, estimatedFiles, estimatedMinutes, risks, requiresFullCycle, patternsToScan, fileExtensions. Без пояснений.`,
      prompt: `Задача: ${taskDescription}`,
      timeoutMs: 60_000,
    });
    const parsed = robustParse<unknown>(result.text);
    if (!parsed.success) throw new Error(`classifier returned non-JSON: ${result.text.slice(0, 120)}`);
    return ClassifiedIntentSchema.parse(coerceClassified(parsed.data));
  }

  /**
   * Default intent для fallback
   */
  private getDefaultIntent(reason: string): ClassifiedIntent {
    return {
      intent: 'EXPLAIN',
      phase: 'DISCOVERY',
      route: 'medium',
      confidence: 0.5,
      reasoning: `Fallback to default intent: ${reason}`,
      allowCode: false,
      suggestedAgents: ['research'],
      estimatedFiles: 1,
      estimatedMinutes: 30,
      risks: ['Classification failed, using default values'],
      requiresFullCycle: true,
      // v3.5: No pattern scanning in fallback
      patternsToScan: [],
      fileExtensions: [],
    };
  }

  /**
   * Конвертировать ClassifiedIntent в DetectedIntent для совместимости с router.ts
   */
  toDetectedIntent(classified: ClassifiedIntent): DetectedIntent {
    return {
      intent: classified.intent,
      confidence: classified.confidence,
      phase: classified.phase,
      allowCode: classified.allowCode,
      fullCycle: classified.requiresFullCycle,
      safetyCheck: true,      // Всегда true
      aiCodingSafety: true,   // Всегда true
      context7: true,         // Всегда true
      grepFirst: true,        // Всегда true
      matchedKeywords: [],    // Deprecated, оставляем пустым
      recommendedRoute: classified.route,
      // v3.5: LLM-selected patterns
      patternsToScan: classified.patternsToScan as ScanPatternId[],
      fileExtensions: classified.fileExtensions,
    };
  }
}

// ============================================
// SINGLETON & EXPORTS
// ============================================

let classifierInstance: IntentClassifier | null = null;

export function getIntentClassifier(): IntentClassifier {
  if (!classifierInstance) {
    classifierInstance = new IntentClassifier();
  }
  return classifierInstance;
}

/**
 * Основная функция классификации — возвращает полный ClassifiedIntent
 */
export async function classifyIntent(description: string): Promise<ClassifiedIntent> {
  return getIntentClassifier().classify(description);
}

/**
 * Совместимость с router.ts — возвращает DetectedIntent
 * ВНИМАНИЕ: Теперь async!
 */
export async function detectIntent(description: string): Promise<DetectedIntent> {
  const classifier = getIntentClassifier();
  const classified = await classifier.classify(description);
  return classifier.toDetectedIntent(classified);
}

// ============================================
// FORMATTING (совместимость с router.ts)
// ============================================

export function getIntentDescription(intent: DetectedIntent): string {
  const descriptions: Record<Intent, string> = {
    LOGS: 'Проверка логов и подготовка отчёта',
    EXPLAIN: 'Объяснение и уточнение',
    DIAGNOSE: 'Диагностика и изучение',
    DISCUSS: 'Продолжение обсуждения',
    PLAN: 'Подготовка плана и архитектуры',
    DOCS: 'Создание документации',
    FIX: 'Исправление ошибки',
    IMPLEMENT: 'Реализация функционала',
    DEPLOY: 'Деплой на продакшен'
  };
  
  const phaseEmoji: Record<Phase, string> = {
    DISCOVERY: '🔍',
    PLANNING: '📋',
    IMPLEMENTATION: '⚡',
    DEPLOYMENT: '🚀'
  };
  
  return `${phaseEmoji[intent.phase]} ${descriptions[intent.intent]}`;
}

export function formatIntentHeader(intent: DetectedIntent): string {
  const codeStatus = intent.allowCode ? '✅ Код разрешён' : '📝 Только анализ';
  
  return `
## 🎯 Определённый интент

| Параметр | Значение |
|----------|----------|
| **Интент** | ${getIntentDescription(intent)} |
| **Фаза** | ${intent.phase} |
| **Код** | ${codeStatus} |
| **Уверенность** | ${(intent.confidence * 100).toFixed(0)}% |

### ✅ Автоматически включено:
- Full Cycle (полный цикл M7)
- Safety Check (patterns/antipatterns)
- AI Coding Safety (понятный код)
- Context7 Verification
- Grep First (поиск перед созданием)
`;
}

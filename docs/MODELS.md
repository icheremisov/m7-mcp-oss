# Модели для M7 (opencode) — выбор по ролям с источниками

Дата сбора: 2026-11-08. Две части доказательств:
1. **Публичные бенчмарки** (внешние лидерборды, ссылки ниже) — про «ум» модели.
2. **Собственный мини-бенч** `scripts/bench-models.mjs` — про то, что важно именно для M7: строгий JSON,
   правильный ответ на задаче с известным решением, задержка и цена через `opencode run`.

## Источники

- **[AA]** Artificial Analysis Intelligence Index v5.0.1 (0–100, лидер Gemini 4 Carbon = 60) и Terminal-Bench 4.0
  (доля решённых агентных задач в терминале): https://artificialanalysis.ai/leaderboards/models
- **[Arena]** LMArena Text, срез 2026-11-06: https://arena.ai/leaderboard/text
- **[Zen]** модели и политика данных OpenCode Zen: https://opencode.ai/v2/docs/console/models/
- **[Go]** лимиты и политика данных OpenCode Go ($10/мес): https://opencode.ai/v2/docs/console/go/
- **[jev]** https://opencode.ai/v2/docs/console/models/#jev

Не удалось получить по этим моделям: SWE-bench Verified/Pro, Aider polyglot, LiveBench, BFCL. У AA нет дат на страницах.

## Сводка по моделям

II — Intelligence Index [AA]; TB — Terminal-Bench 4.0 [AA]; т/с — скорость вывода [AA]; 5ч — запросов за 5 часов на Go [Go].

| Модель | Что это | II | TB | т/с | Arena | Лимит / цена | Данные |
|---|---|---|---|---|---|---|---|
| `opencode/deepseek-v4.1-flash-free` | DeepSeek V4.1 Flash 552B/16B | 32.6 (max) | 0.338 | 154 | 1475 (#37) | free, общий лимит | zero-retention [Zen] |
| `opencode/glm-5.3-flash-free` | Zhipu GLM-5.3-Flash 320B/18B | 27.8 | 0.328 | 54 | — | free | zero-retention [Zen] |
| `opencode/mimo-v2.6-flash-free` | Xiaomi MiMo-V2.6-Flash | 26.7 | 0.227 | 37 | — | free временно | **может идти на обучение** [Zen] |
| `opencode/beam-free` | Reflection Beam 1.0, 501B/23B | 17.7 | 0.03 | 236 | 1435 (#106) | free | не обучают, 30 дней [Zen] |
| `opencode/big-pickle` | stealth, вендор не раскрыт | — | — | — | — | free временно | **может идти на обучение** [Zen] |
| `opencode/flint-40b-free` | Recursive Flint 39.8B/2.5B | — | — | — | — | free временно | **может идти на обучение**, 30 дней [Zen] |
| `opencode/nemotron-3.5-*-free` | NVIDIA 31.6B / 120B | 5.5 / 13.6 | ~0 | 251 / 177 | — | trial | логируются у NVIDIA [Zen] |
| `opencode-go/deepseek-v4.1-flash` | = free-версия | 32.6 | 0.338 | 154 | 1475 | 43 330/5ч | ZDR [Go] |
| `opencode-go/claude-haiku-5-5` | Anthropic | 36.5 (max) / 29.9 (high) | 0.328 | ~220 | 1423 | 3 850/5ч | не обучают, 30 дней [Go] |
| `opencode-go/minimax-m3.1-flash` | MiniMax 428B/23B | 29.1 | 0.258 | 156 | — | 3 880/5ч | 0 дней [Go] |
| `opencode-go/glm-5.3-flash` | = free-версия | 27.8 | 0.328 | 54 | — | 6 320/5ч | 0 дней |
| `opencode-go/glm-5.3` | Zhipu 753B/40B | 31.7 | 0.419 | 66 | 1482 (#26) | 220/5ч | 0 дней |
| `opencode-go/mimo-v2.6-pro` | Xiaomi 1.02T/42B | 29.9 | 0.348 | 48 | 1479 (#29) | 3 250/5ч | 0 дней |
| `opencode-go/qwen3.8-max` | Alibaba | 33.7 | 0.389 | 46 | 1483 (#23) | 160/5ч | 0 дней |
| `opencode-go/grok-4.7` | xAI | 35.5 (xhigh) | 0.258 | 70 | 1442 | 169/5ч | 30 дней |
| `opencode-go/hy4-preview` | Tencent (в AA — «Hy4») | 34.6 | 0.374 | 94 | — | 1 350/5ч | 0 дней |
| `opencode-go/gemini-4-argon` | Google | **50.4** | 0.571 | 70 | **1523 (#2)** | 440/5ч | 0 дней |
| `opencode-go/kimi-k3.1-pro` | Moonshot 2.8T/104B | 46.5 | **0.672** | 33, TTFT 193 с | — | 147/5ч | 0 дней |
| `opencode-go/step-5-preview` | StepFun 600B/27B | 28.5 | 0.333 | 135 | 1448 | 430/5ч | 0 дней |
| `opencode-go/gpt-6-luna` | OpenAI | 27.9 (max) | 0.126 | ~95 | 1440 | 4 230/5ч | 30 дней |
| `opencode-go/deepseek-v4-pro` | DeepSeek 1.6T/49B | 23.1 | 0.141 | 67 | 1464 | 1 050/5ч | ZDR |
| `jev` | TypeSafe AI «System One»: типизированные ответы с вероятностями | — | — | — | — | $0.042/1M вход, вывод бесплатен | не указано [Zen] |

### Модели под кодовыми именами

- **big-pickle** — вендор официально не назван. Единственная цифра — сторонний самоотчёт SWE Atlas Codebase QnA 50.81%
  (для сравнения GLM 5.2 — 48.12, Opus 5 — 63.17; одна попытка вместо трёх, ±4.5, Scale не проверял):
  https://github.com/PhillipChaffee/big-pickle-swe-atlas. Версии «это DeepSeek» / «это MiniMax» — догадки.
  Под алиасом модель может смениться без предупреждения; данные могут идти на улучшение модели.
- **flint-40b-free** — Recursive Flint 39.8B/2.5B (2026-10-21). Только вендорские цифры (SWE-bench Verified 74.2%,
  Terminal-Bench 2.1 54.9%: https://tech-insider.org/flint-ai-coding-model-swe-bench-2026/), независимо не
  воспроизведены и неправдоподобно высоки для 2.5B активных параметров. В AA нет.
- **beam-free** — Reflection Beam 1.0; вендор заявляет «близко к GLM-5.2», независимые данные этого не подтверждают
  (II 17.7, Arena #106), зато очень быстрая (236 т/с) и без обучения на данных.
- **iceman-contributor-free**, **muse-spark-1.x-contributor** (Meta; Muse Spark 1.3: II 36.6, TB 0.333 [AA]) —
  «contributor»-версии: промпты и ответы **используются для обучения** [Go]. В пресеты не включены.

## Результаты мини-бенча

Прогон 2026-11-08 14:40 UTC, 2 прогона × 3 задачи на модель, последовательно (M7_LLM_CONCURRENCY=1), через `opencode run` из адаптера M7. Сырые данные: [docs/bench/results.json](bench/results.json).

| Модель | Верно | Валидный JSON | Сбои | p50 задержка | Цена за 6 вызовов |
|---|---|---|---|---|---|
| `opencode-go/deepseek-v4.1-flash` | 6/6 | 6/6 | 0 | 7.5 с | $0.0037 |
| `opencode-go/claude-haiku-5-5` | 6/6 | 6/6 | 0 | 5.3 с | $0.0027 |
| `opencode-go/minimax-m3.1-flash` | 6/6 | 6/6 | 0 | 13.1 с | $0.0032 |
| `opencode-go/glm-5.3-flash` | 6/6 | 6/6 | 0 | 7.4 с | $0.0024 |
| `opencode-go/glm-5.3` | 6/6 | 6/6 | 0 | 12.8 с | $0.0408 |
| `opencode-go/qwen3.8-flash` | 6/6 | 6/6 | 0 | 6.2 с | $0.0021 |
| `opencode-go/mimo-v2.6-flash` | 6/6 | 6/6 | 0 | 15.0 с | $0.0023 |
| `opencode-go/kimi-k2.7-code` | 6/6 | 6/6 | 0 | 10.9 с | $0.0172 |
| `opencode-go/gemini-4-argon` | 6/6 | 6/6 | 0 | 15.5 с | $0.0630 |
| `opencode-go/kimi-k3.1-pro` | 6/6 | 6/6 | 0 | 19.4 с | $0.0529 |
| `opencode-go/qwen3.8-max` | 6/6 | 6/6 | 0 | 24.3 с | $0.0357 |
| `opencode/deepseek-v4.1-flash-free` | 0/1 | 0/1 | 1 (квота free исчерпана) | — | — |
| `opencode/glm-5.3-flash-free` | 0/1 | 0/1 | 1 (квота free исчерпана) | — | — |
| `opencode/big-pickle` | 0/1 | 0/1 | 1 (квота free исчерпана) | — | — |
| `opencode/beam-free` | 0/1 | 0/1 | 1 (квота free исчерпана) | — | — |
| `opencode/flint-40b-free` | 0/1 | 0/1 | 1 (квота free исчерпана) | — | — |

Что показал и чего не показал бенч:
- Все 12 моделей Go дали валидный JSON и правильный ответ во всех 6 вызовах. Задачи (команда экспертов по схеме,
  гонка в `transfer()` без транзакции, выбор верного предложения критиком) оказались по силам всем — **по качеству
  рассуждений бенч модели не различает**, это берём из [AA]/[Arena]. Различает он задержку и цену.
- Цена — номинальная, как её считает opencode; на подписке Go фактически расходуются запросы из лимита «5ч».
- Бесплатные модели проверить не удалось: общая free-квота OpenCode на этом аккаунте исчерпана
  («Free usage limit reached»). Адаптер завершает такой вызов сразу с текстом ошибки провайдера.
- Живой прогон `mcp_m7_hive_coordinator` (dynamic, 3 эксперта, 1 раунд дебатов, пресет cheap): 109 с, $0.02.
- Классификатор `jev`: ~0.3 с на задачу, 4/4 верно на контрольных задачах (FIX / EXPLAIN / IMPLEMENT + console-logs /
  PLAN без кода); фолбэк через `opencode run` — 7–9 с.


## Выбор по ролям (пресеты в `src/llm/models.ts`)

| Роль | Что нужно | free | cheap (по умолчанию) | strong |
|---|---|---|---|---|
| classifier | типизированный выбор из enum | **jev** (0.3 с), фолбэк `opencode/deepseek-v4.1-flash-free` | **jev**, фолбэк `opencode-go/deepseek-v4.1-flash` | **jev**, фолбэк `opencode-go/claude-haiku-5-5` |
| architect / planner / synthesizer | рассуждение + строгий JSON | `opencode/deepseek-v4.1-flash-free` — лучший II среди free (32.6) | `opencode-go/deepseek-v4.1-flash` — II 32.6, 7.5 с, лимит 43 330/5ч | `opencode-go/gemini-4-argon` — II 50.4, Arena #2 |
| experts (3 разных семейства) | разнообразие мнений | DeepSeek V4.1 Flash free + GLM-5.3-Flash free (обе zero-retention) + Beam free (без обучения на данных) | DeepSeek V4.1 Flash (32.6) + Claude Haiku 5.5 @high (29.9, 5.3 с) + GLM-5.3-Flash (27.8, 7.4 с) | Gemini 4 Argon (50.4) + Kimi K3.1 Pro (46.5) + Qwen3.8 Max (33.7) |
| critic | дёшево и быстро, вердикт JSON | `opencode/deepseek-v4.1-flash-free` | `opencode-go/glm-5.3-flash` — 7.4 с, $0.0024 за 6 вызовов, 6 320/5ч | `opencode-go/claude-haiku-5-5@high` |
| executor (planned, с кодом) | агентные задачи с кодом (TB) | `opencode/glm-5.3-flash-free` — TB 0.328, zero-retention | `opencode-go/glm-5.3` — TB 0.419, лучший среди недорогих | `opencode-go/kimi-k3.1-pro` — TB 0.672, максимум в списке |

Почему так:
- **Эксперты из разных семейств** (DeepSeek / Anthropic / Zhipu), иначе дебаты превращаются в эхо.
  MiniMax-M3.1-Flash (II 29.1) был в первой версии пресета, но в бенче он вдвое медленнее (13.1 с против 7.4 с у GLM-5.3-Flash),
  а эксперты ждут самого медленного — заменён.
- **Критик** вызывается последовательно по нескольку раз за раунд, поэтому важна задержка: GLM-5.3-Flash.
  qwen3.8-flash ещё быстрее и дешевле (6.2 с), но у AA есть только «Qwen3.8-Flash-Next», совпадение не подтверждено — не беру без данных.
- **big-pickle, flint, mimo-free, iceman, muse-contributor** не в пресетах: нет независимых бенчмарков и/или данные
  могут идти на обучение — а Hive отправляет фрагменты кода. Попробовать можно явно: `models: {experts: ["opencode/big-pickle", …]}`.
- **strong** упирается в лимиты Go (Gemini 4 Argon — 440, Kimi K3.1 Pro — 147 запросов за 5ч; у Kimi первый токен до 193 с).
  Один dynamic-прогон Hive — это ~8–12 вызовов.


## Как выбирать модель самому

- В диалоге: «покажи модели m7» → `mcp_m7_models`; «прогони через hive на strong» или «экспертами возьми kimi-k3.1-pro и
  gemini-4-argon» → `mcp_m7_hive_coordinator` с `preset` / `models`.
- Постоянно: env `M7_MODEL_PRESET`, `M7_MODEL_<ROLE>`, `M7_MODEL_EXPERTS` в конфиге MCP; страховка `M7_MODEL_ALLOW`.
- Перепроверить на своих моделях: `node scripts/bench-models.mjs --models a,b,c --runs 3`.

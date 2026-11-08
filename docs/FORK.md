# Secure fork — what changed and why

Base: [DukeDeSouth/m7-mcp-oss](https://github.com/DukeDeSouth/m7-mcp-oss) @ `0ace0ab` (v3.22.2).
Every upstream module was audited before the fork; this page lists the findings and what was done about each.

## Findings in upstream

| # | Severity | Where | Problem | Fix in fork |
|---|---|---|---|---|
| 1 | critical | `install.sh` `configure_cursor` | `cat > ~/.cursor/mcp.json` replaced the whole Cursor config (other MCP servers lost, only a backup left) and wrote API keys into it in plain text | `install.sh` only builds; `scripts/register.mjs` merges one entry with a backup, refuses to overwrite (claude, cursor, codex, opencode, dsh) |
| 2 | critical | `analyzeTask.ts` cold start → `initProject.ts` | first `analyze_task` in any repo without `memory-bank/` / `.cursorrules` silently overwrote `README.md`, `INDEX.md`, `MASTER_REFERENCE.md`, `CODING_STANDARDS.md`, `CYCLE_REGISTRY.md`, `.cursorrules`, `.cursor/rules/m7-memory.mdc` | auto-init only with `M7_AUTO_INIT=true`; init writes only missing files (`wx`); agent rule files only with `M7_WRITE_AGENT_RULES=true` |
| 3 | high | `projectPath.ts` | project = "most recently active Cursor project" from `~/.cursor/projects` (wrong repo for Claude Code / Codex); home dir accepted as a project if it has `.git`; "refusing home" branch still returned home | scan is opt-in (`M7_CURSOR_PROJECTS_SCAN=true`); home / filesystem root never accepted (temp placeholder instead); every resolved workspace (Roots, env, cwd, `project_path`) checked against the policy, optional `M7_ALLOWED_ROOTS` |
| 4 | high | `index.ts` | `dotenv` read `.env` from cwd — an untrusted repo could set `OPENAI_BASE_URL` and receive the keys | no dotenv, no keys |
| 5 | high | `index.ts` | server refused to start without both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, then pinged Anthropic up to 5 times at startup (model discovery) | keys removed; LLM via opencode; no startup network calls |
| 6 | medium | `visualizer-server.ts` | HTTP 3848 / WS 3847 on all interfaces, no auth, `Access-Control-Allow-Origin: *`, no WS origin check → project graph and current task readable from LAN and any website; XSS via file/symbol names | `127.0.0.1`, no CORS, origin check, HTML escaping |
| 7 | medium | `meshTool.ts` `pull-file` | `startsWith(projectPath)` without separator (`/proj-evil` passes), no symlink check, blocklist only on push → a relay peer could write `.git/hooks/*`, `.cursor/mcp.json`, `.claude/settings.json` | separator-aware check, realpath, dot-paths and secret extensions blocked both ways |
| 8 | medium | `projectIndexTool.ts` | `output_path` could be any absolute path | must be inside the project |
| 9 | medium | `hiveCoordinator.ts` | mesh peer contexts (other projects on the machine) were injected into LLM prompts | removed |
| 10 | low (dead code) | `core/extensions` | `import()` of any `.js` from `~/.m7/extensions` | module deleted |
| 11 | deps | `package-lock.json` | 21 advisories (2 critical), mostly via unused `chromadb-default-embed` (onnxruntime → protobufjs, sharp) | 5 left, all DoS-class on local input (zod < 4.6.6, ts-morph → minimatch, diff — only `createTwoFilesPatch` used) |

Not found: no `eval` / `new Function` / `vm`, no install hooks, SQL via prepared statements, telemetry really opt-in
(nothing leaves without `M7_TELEMETRY_ENDPOINT`), `execFile` without shell everywhere.

## LLM calls

Upstream called OpenAI / Anthropic SDKs from 11 places, only for two tools: `mcp_m7_analyze_task`
(intent classification, `gpt-4o-mini`) and `mcp_m7_hive_coordinator` (architect, planner, experts,
debates, synthesizer, subtask executor; hardcoded `claude-opus-4-6`, `gpt-5.5` …). The other 36 tools never call a model.

Now everything goes through `src/llm`:

- **`jev`** (OpenCode Zen System One) classifies the task in one request (~0.3 s): intent and route as `choice`,
  agents / patterns / allowCode / fullCycle as yes-probabilities. Only the task text is sent.
  Fallback: `opencode run` with the classifier model, then the default intent. `M7_CLASSIFIER=jev|opencode|off`.
- **`opencode run`** for Hive roles, sandboxed: private `XDG_CONFIG_HOME` (your `~/.config/opencode` with its MCP
  servers and agents is not loaded), agent `m7-llm` with all tools and permissions denied, empty temp cwd, killed on
  the first provider error (opencode otherwise retries "usage limit" forever), session deleted afterwards.
- Hive **planned** mode still sends up to 10 project source files × 100 lines to the executor model — keep that in mind
  when choosing free models whose providers may train on data (see `docs/MODELS.md`).

## Configuration (env in the MCP client config)

| Variable | Default | Meaning |
|---|---|---|
| `M7_MODEL_PRESET` | `cheap` | `free` / `cheap` / `strong` role table (see `docs/MODELS.md`) |
| `M7_MODEL_DEFAULT` | — | one model for every single-model role |
| `M7_MODEL_ARCHITECT`, `_PLANNER`, `_CRITIC`, `_SYNTHESIZER`, `_EXECUTOR`, `_CLASSIFIER` | preset | per role, `provider/model[@variant]` |
| `M7_MODEL_EXPERTS` | preset | comma list; experts take models round-robin (keep families different) |
| `M7_MODEL_ALLOW` | — | comma globs, e.g. `opencode/*-free,opencode-go/*` |
| `M7_CLASSIFIER` | `jev` | `jev` / `opencode` / `off` |
| `M7_LLM_CONCURRENCY` / `M7_LLM_TIMEOUT_MS` | 4 / 180000 | opencode process limits |
| `M7_OPENCODE_BIN` | `opencode` | path to the CLI |
| `OPENCODE_API_KEY` | from `~/.local/share/opencode/auth.json` | key for jev |
| `M7_AUTO_INIT`, `M7_WRITE_AGENT_RULES`, `M7_CURSOR_PROJECTS_SCAN` | off | upstream behaviours, opt-in |
| `M7_ALLOWED_ROOTS` | — | `:`-separated directories a project must be inside |

From the dialog: `mcp_m7_models` shows the table and available models; `mcp_m7_hive_coordinator` accepts
`preset` and `models: {architect, planner, experts[], critic, synthesizer, executor}`.

## Still worth knowing

- M7 writes its own state into the project: `.m7/`, `m7-cycles/`, `docs/hive/`, and after `init_project`
  `memory-bank/` and the knowledge files. `~/.m7/` holds telemetry consent, style profile and error DB.
- Free OpenCode models have a shared usage limit; when it is reached calls fail fast with the provider message.

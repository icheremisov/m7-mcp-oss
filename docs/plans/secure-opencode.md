# Форк: безопасные умолчания + LLM через opencode

Ветка `secure-opencode`. Upstream: DukeDeSouth/m7-mcp-oss @ 0ace0ab (v3.22.2).

## Безопасность
- [x] Cold start в analyze_task не пишет файлы (только подсказка вызвать init_project)
- [x] init_project пишет только отсутствующие файлы (`wx`), README.md не трогает
- [x] projectPath: без скана ~/.cursor/projects, домашний каталог — ошибка, а не fallback
- [x] project_path / output_path ограничены корнем (M7_ALLOWED_ROOTS)
- [x] dotenv убран (ключи только из env MCP-конфига)
- [x] visualizer: 127.0.0.1, без CORS *, проверка Origin у WS, XSS (textContent)
- [x] mesh pull-file: path.sep, realpath, запрет dot-каталогов
- [x] extensions (динамический import) удалён
- [x] install.sh: не перезаписывает ~/.cursor/mcp.json

## LLM
- [x] src/llm/: complete() через `opencode run` (изолированный конфиг, инструменты запрещены)
- [x] src/llm/: jev-классификатор (Zen System One) для analyze_task + фолбэк
- [x] выбор моделей: env → пресеты → аргументы тулов; allowlist
- [x] hive: все вызовы через llm.complete; убран modelDiscovery и проверка ключей
- [x] тул mcp_m7_models
- [x] убраны openai, @anthropic-ai/sdk, chromadb, chromadb-default-embed; обновлены уязвимые

## Проверка
- [x] npm run build, npm test
- [x] живой прогон MCP (tools/list, analyze_task, hive на free)
- [ ] мини-бенч моделей → пресеты

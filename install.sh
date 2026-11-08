#!/bin/bash
# ============================================
# M7 MCP Server (fork) - build script
# ============================================
# Builds the server. It does NOT touch any agent config and does NOT ask for API keys:
# LLM calls go through the local `opencode` CLI.
#
# To register the server in an agent (adds one entry, keeps everything else, makes a backup):
#   node scripts/register.mjs claude|cursor|codex|opencode [--dry-run]
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

need() { command -v "$1" >/dev/null 2>&1 || { echo "❌ $1 not found: $2"; exit 1; }; }

need node "install Node.js 22+"
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  echo "❌ Node.js 22+ required (found $(node --version))"; exit 1
fi
need npm "comes with Node.js"

if command -v opencode >/dev/null 2>&1; then
  echo "✅ opencode $(opencode --version)"
else
  echo "⚠️  opencode not found — Hive and the classifier fallback will not work (https://opencode.ai)"
fi

echo "📦 npm ci"
npm ci --no-audit --no-fund
echo "🔨 npm run build"
npm run build

cat <<EOF

✅ Built: $SCRIPT_DIR/dist/index.js

Register in an agent (one entry is merged, other servers are kept, a backup is written):
  node scripts/register.mjs claude      # Claude Code, user scope (via \`claude mcp add\`)
  node scripts/register.mjs cursor      # ~/.cursor/mcp.json
  node scripts/register.mjs codex       # ~/.codex/config.toml
  node scripts/register.mjs opencode    # ~/.config/opencode/opencode.jsonc
  node scripts/register.mjs dsh         # DeepSeek Harness (~/.dsh/profiles/desktop/cordis.patch.yml)
Add --dry-run to see the change without writing.
EOF

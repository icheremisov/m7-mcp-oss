#!/usr/bin/env node
/**
 * Register the M7 MCP server in one agent without touching anything else.
 *
 *   node scripts/register.mjs claude|cursor|codex|opencode|dsh [--dry-run] [--name m7] [--force]
 *   (dsh = DeepSeek Harness with the dsh-mcp-manager plugin, $DSH_HOME/mcp-servers.json)
 *
 * - Adds exactly one server entry; other servers and settings are preserved.
 * - Writes a timestamped backup next to the config before changing it.
 * - Refuses to overwrite an existing entry with the same name unless --force.
 * - Puts no secrets into the config: LLM calls go through the local `opencode` CLI.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'dist', 'index.js');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const nameIdx = args.indexOf('--name');
const NAME = nameIdx >= 0 ? args[nameIdx + 1] : 'm7';

if (!['claude', 'cursor', 'codex', 'opencode', 'dsh'].includes(target)) {
  console.error('usage: node scripts/register.mjs claude|cursor|codex|opencode|dsh [--dry-run] [--name m7] [--force]');
  process.exit(2);
}
if (!existsSync(ENTRY)) {
  console.error(`❌ ${ENTRY} not found — run ./install.sh (or npm run build) first`);
  process.exit(1);
}

const NODE = process.execPath;

function backupAndWrite(file, content) {
  if (dryRun) {
    console.log(`--- would write ${file} ---\n${content}`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.backup-${stamp}`;
    copyFileSync(file, backup);
    console.log(`🗂  backup: ${backup}`);
  }
  const tmp = `${file}.m7tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
  console.log(`✅ ${file}: added "${NAME}"`);
}

/**
 * Minimal JSONC → JSON: strips comments and trailing commas, only outside strings
 * (string contents such as ",}" are kept verbatim).
 */
function parseJsonc(text) {
  const stripComments = src => {
    let out = '';
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const n = src[i + 1];
      if (inStr) {
        out += c;
        if (c === '\\') { out += n ?? ''; i++; } else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
      out += c;
    }
    return out;
  };
  const stripTrailingCommas = src => {
    let out = '';
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        out += c;
        if (c === '\\') { out += src[i + 1] ?? ''; i++; } else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ',') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === '}' || src[j] === ']') continue;
      }
      out += c;
    }
    return out;
  };
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}

function hasComments(text) {
  try { JSON.parse(text); return false; } catch { return true; }
}

switch (target) {
  case 'claude': {
    let exists = false;
    try {
      execFileSync('claude', ['mcp', 'get', NAME], { stdio: 'pipe' });
      exists = true;
    } catch { /* not registered */ }
    if (exists && !force) {
      console.error(`❌ Claude Code already has an MCP server "${NAME}" — use --force or --name`);
      process.exit(1);
    }
    const cmd = ['mcp', 'add', '--scope', 'user', NAME, '--', NODE, ENTRY];
    if (dryRun) { console.log(`would run: claude ${cmd.join(' ')}`); break; }
    if (exists) execFileSync('claude', ['mcp', 'remove', '--scope', 'user', NAME], { stdio: 'inherit' });
    // `claude mcp add` merges into ~/.claude.json itself
    execFileSync('claude', cmd, { stdio: 'inherit' });
    break;
  }

  case 'cursor': {
    const file = join(homedir(), '.cursor', 'mcp.json');
    const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
    config.mcpServers ??= {};
    if (config.mcpServers[NAME] && !force) {
      console.error(`❌ ${file} already has "${NAME}" — use --force or --name`);
      process.exit(1);
    }
    // Cursor passes the workspace via MCP Roots; no project path is pinned here.
    config.mcpServers[NAME] = { command: NODE, args: [ENTRY] };
    backupAndWrite(file, `${JSON.stringify(config, null, 2)}\n`);
    break;
  }

  case 'codex': {
    const file = join(homedir(), '.codex', 'config.toml');
    const text = existsSync(file) ? readFileSync(file, 'utf-8') : '';
    const header = `[mcp_servers.${NAME}]`;
    if (text.split('\n').some(l => l.trim() === header)) {
      console.error(`❌ ${file} already has ${header} — edit it by hand`);
      process.exit(1);
    }
    const block = `\n${header}\ncommand = ${JSON.stringify(NODE)}\nargs = [${JSON.stringify(ENTRY)}]\n`;
    backupAndWrite(file, text.replace(/\n*$/, '\n') + block);
    break;
  }

  case 'opencode': {
    const dir = join(homedir(), '.config', 'opencode');
    const file = ['opencode.jsonc', 'opencode.json'].map(f => join(dir, f)).find(existsSync) ?? join(dir, 'opencode.json');
    const text = existsSync(file) ? readFileSync(file, 'utf-8') : '{}';
    if (hasComments(text) && !force) {
      console.error(`❌ ${file} contains comments/trailing commas that would be lost — use --force or edit by hand`);
      process.exit(1);
    }
    const config = parseJsonc(text);
    config.mcp ??= {};
    if (config.mcp[NAME] && !force) {
      console.error(`❌ ${file} already has mcp.${NAME} — use --force or --name`);
      process.exit(1);
    }
    config.mcp[NAME] = { type: 'local', command: [NODE, ENTRY], enabled: true };
    backupAndWrite(file, `${JSON.stringify(config, null, 2)}\n`);
    break;
  }
  case 'dsh': {
    // DeepSeek Harness with the dsh-mcp-manager plugin: servers live in $DSH_HOME/mcp-servers.json
    // (shared by all profiles and sessions, hot-reloaded by the plugin)
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
    const file = join(dshHome, 'mcp-servers.json');
    const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : { version: 1, servers: [] };
    config.servers ??= [];
    const idx = config.servers.findIndex(sv => sv.serverName === NAME);
    if (idx >= 0 && !force) {
      console.error(`❌ ${file} already has "${NAME}" — use --force or --name`);
      process.exit(1);
    }
    const entry = { serverName: NAME, transport: 'stdio', command: NODE, args: [ENTRY], toolCallTimeoutMs: 900000, enabled: true };
    if (idx >= 0) config.servers[idx] = entry; else config.servers.push(entry);
    backupAndWrite(file, `${JSON.stringify(config, null, 2)}\n`);
    break;
  }
}

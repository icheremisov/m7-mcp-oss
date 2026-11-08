/**
 * Text completion through the opencode CLI (`opencode run`).
 *
 * Isolation — the model must only produce text:
 *   - XDG_CONFIG_HOME points to a private config: the user's ~/.config/opencode (MCP servers, agents,
 *     plugins) is not loaded; the "m7-llm" agent has every tool and permission denied.
 *   - cwd is an empty temp directory, so no project opencode.json / AGENTS.md is picked up.
 *   - Auth still comes from ~/.local/share/opencode (XDG_DATA_HOME is untouched).
 *   - The session is deleted after each call so it does not clutter `opencode session list`.
 *
 * opencode retries provider errors (e.g. "Free usage limit reached") forever, so stderr is watched
 * for ERROR log lines and the process is killed on the first one, plus a hard timeout.
 */

import { execFile } from 'child_process';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import PQueue from 'p-queue';
import { createLogger } from '../core/utils/logger.js';
import { parseModelSpec, validateModel } from './models.js';

const log = createLogger('[llm/opencode]');

export interface CompleteRequest {
  /** Full model spec, "provider/model[@variant]" */
  model: string;
  system?: string;
  prompt: string;
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  tokens: { input: number; output: number; total: number };
  cost: number;
  finishReason: string;
  durationMs: number;
}

const AGENT = 'm7-llm';
const DEFAULT_TIMEOUT_MS = Number(process.env.M7_LLM_TIMEOUT_MS) || 180_000;
const queue = new PQueue({ concurrency: Number(process.env.M7_LLM_CONCURRENCY) || 4 });

let sandbox: { configHome: string; workDir: string } | null = null;

function ensureSandbox(): { configHome: string; workDir: string } {
  if (sandbox && existsSync(sandbox.workDir)) return sandbox;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  const root = join(tmpdir(), `m7-opencode-${uid}`);
  const configHome = join(root, 'config');
  const workDir = join(root, 'work');
  mkdirSync(join(configHome, 'opencode'), { recursive: true, mode: 0o700 });
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const config = {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    mcp: {},
    plugin: [],
    permission: { '*': 'deny' },
    agent: {
      [AGENT]: {
        mode: 'primary',
        description: 'M7 text-only completion',
        prompt: 'You are a text-only assistant inside an automated pipeline. Never use tools. Answer exactly in the requested format.',
        permission: { '*': 'deny' },
        tools: { '*': false },
      },
    },
  };
  writeFileSync(join(configHome, 'opencode', 'opencode.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  sandbox = { configHome, workDir };
  return sandbox;
}

function buildMessage(system: string | undefined, prompt: string): string {
  if (!system) return prompt;
  return `<instructions>\n${system}\n</instructions>\n\n${prompt}`;
}

function deleteSession(bin: string, env: NodeJS.ProcessEnv, cwd: string, sessionId: string): void {
  execFile(bin, ['session', 'delete', sessionId], { env, cwd, timeout: 30_000 }, err => {
    if (err) log.debug(`session delete failed for ${sessionId}: ${err.message}`);
  });
}

function runOnce(req: CompleteRequest): Promise<CompleteResult> {
  const bin = process.env.M7_OPENCODE_BIN || 'opencode';
  const { configHome, workDir } = ensureSandbox();
  const { model, variant } = parseModelSpec(req.model);
  const args = ['run', '--pure', '--format', 'json', '--title', 'm7', '--print-logs', '--log-level', 'ERROR',
    '--agent', AGENT, '-m', model];
  if (variant) args.push('--variant', variant);
  args.push('--', buildMessage(req.system, req.prompt));

  const env = { ...process.env, XDG_CONFIG_HOME: configHome };
  const started = Date.now();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // execFile without a shell; output is consumed as a stream, the callback only reports spawn errors
    const child = execFile(bin, args, { cwd: workDir, env, maxBuffer: 64 * 1024 * 1024 }, () => {});
    child.stdin?.end();
    const texts = new Map<string, string>();
    let sessionId: string | null = null;
    let tokens = { input: 0, output: 0, total: 0 };
    let cost = 0;
    let finishReason = 'unknown';
    let stdoutBuf = '';
    let stderrBuf = '';
    let failure: Error | null = null;
    let settled = false;

    const fail = (err: Error) => {
      if (!failure) failure = err;
      if (!child.killed) child.kill('SIGTERM');
    };
    const timer = setTimeout(() => fail(new Error(`opencode timeout after ${timeoutMs} ms (${req.model})`)), timeoutMs);

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let evt: any;
      try { evt = JSON.parse(line); } catch { return; }
      if (evt.sessionID) sessionId = evt.sessionID;
      const part = evt.part ?? {};
      if (evt.type === 'text' && typeof part.text === 'string') {
        texts.set(part.id ?? String(texts.size), part.text);
      } else if (evt.type === 'step_finish') {
        const t = part.tokens ?? {};
        tokens = {
          input: tokens.input + (t.input ?? 0),
          output: tokens.output + (t.output ?? 0),
          total: tokens.total + (t.total ?? 0),
        };
        cost += part.cost ?? 0;
        finishReason = part.reason ?? finishReason;
      } else if (evt.type === 'error') {
        fail(new Error(`opencode error: ${JSON.stringify(evt.error ?? evt).slice(0, 500)}`));
      }
    };

    child.stdout!.on('data', chunk => {
      stdoutBuf += chunk.toString();
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        handleLine(stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
      }
    });
    child.stderr!.on('data', chunk => {
      stderrBuf = (stderrBuf + chunk.toString()).slice(-8000);
      const m = stderrBuf.match(/level=ERROR[^\n]*?(?:error\.error|error)="([^"]{0,400})/);
      if (m) fail(new Error(`opencode provider error (${req.model}): ${m[1]}`));
    });
    child.on('error', err => fail(new Error(`cannot start opencode (${bin}): ${err.message}`)));
    child.on('close', code => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      handleLine(stdoutBuf);
      if (sessionId) deleteSession(bin, env, workDir, sessionId);
      const text = [...texts.values()].join('\n').trim();
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`opencode exited with ${code}: ${stderrBuf.slice(-400)}`));
      if (!text) return reject(new Error(`opencode returned empty text (${req.model})`));
      resolve({ text, model: req.model, tokens, cost, finishReason, durationMs: Date.now() - started });
    });
  });
}

/** One completion. Validates the model (allowlist + `opencode models`) and limits concurrency. */
export async function complete(req: CompleteRequest): Promise<CompleteResult> {
  await validateModel(req.model);
  const result = await queue.add(() => runOnce(req));
  log.debug(`${req.model}: ${result!.durationMs} ms, ${result!.tokens.total} tok, $${result!.cost.toFixed(5)}`);
  return result!;
}

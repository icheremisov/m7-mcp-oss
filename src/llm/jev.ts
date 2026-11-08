/**
 * jev — OpenCode Zen "System One" typed classifier: returns calibrated probabilities instead of text.
 * Docs: https://opencode.ai/v2/docs/console/models/#jev
 *
 * Key: OPENCODE_API_KEY, else the opencode key from ~/.local/share/opencode/auth.json
 * (providers "opencode" / "opencode-go"), same as `opencode auth login` stores it.
 * Only the `state` text (the task description) is sent.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> };

/** noul → probability of "yes"; choice → probability per option */
export type JevAnswer = number | Record<string, number>;

const ENDPOINT = process.env.M7_JEV_ENDPOINT || 'https://opencode.ai/zen/v1/systemone';
const MODEL = process.env.M7_JEV_MODEL || 'jev-1.13';
const TIMEOUT_MS = 30_000;
const RETRIES = 3;

function loadKey(): string {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  try {
    const auth = JSON.parse(readFileSync(join(dataHome, 'opencode', 'auth.json'), 'utf-8'));
    for (const provider of ['opencode', 'opencode-go']) {
      const key = auth?.[provider]?.key;
      if (typeof key === 'string' && key) return key;
    }
  } catch {
    // fall through
  }
  throw new Error('jev: no key — set OPENCODE_API_KEY or run `opencode auth login`');
}

export async function askJev<Q extends Record<string, JevQuestion>>(
  state: string,
  questions: Q,
): Promise<{ [K in keyof Q]: JevAnswer }> {
  const key = loadKey();
  const body = JSON.stringify({ model: MODEL, state, questions });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'm7-mcp/1' },
        body,
        signal: controller.signal,
      });
      if (resp.status === 429 || resp.status >= 500) {
        lastError = new Error(`jev HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        if (/UsageLimit/i.test(lastError.message)) throw lastError;
        await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
        continue;
      }
      if (!resp.ok) throw new Error(`jev HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data: any = await resp.json();
      const out: Record<string, JevAnswer> = {};
      for (const q of Object.keys(questions)) {
        const a = data?.answers?.[q];
        if (!a) throw new Error(`jev: no answer for "${q}"`);
        out[q] = 'noul' in a ? Number(a.noul) : { ...a.probabilities };
      }
      return out as { [K in keyof Q]: JevAnswer };
    } catch (err: any) {
      lastError = err.name === 'AbortError' ? new Error('jev timeout') : err;
      if (/UsageLimit|HTTP 4\d\d/.test(lastError!.message) && !/HTTP 429/.test(lastError!.message)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('jev failed');
}

export function argmax(probs: Record<string, number>): [string, number] {
  let best: [string, number] = ['', -1];
  for (const [k, v] of Object.entries(probs)) if (v > best[1]) best = [k, v];
  return best;
}

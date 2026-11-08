#!/usr/bin/env node
/**
 * Mini-benchmark of opencode models for M7 Hive roles (uses the built adapter in dist/llm).
 *
 *   node scripts/bench-models.mjs [--models a,b,c] [--runs 2] [--out docs/bench/results.json]
 *
 * Three role-shaped prompts with checkable answers:
 *   architect — build an expert team as strict JSON (schema check)
 *   expert    — find the real bug in a code snippet, answer as JSON (correctness check)
 *   critic    — judge two proposals, JSON verdict (must pick the correct one)
 * Metrics per model: JSON validity, task correctness, median latency, cost, failures.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { complete } = await import(resolve(ROOT, 'dist/llm/index.js'));
const { robustParse } = await import(resolve(ROOT, 'dist/hive/utils/json/index.js'));

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };

const DEFAULT_MODELS = [
  'opencode-go/deepseek-v4.1-flash', 'opencode-go/claude-haiku-5-5', 'opencode-go/minimax-m3.1-flash',
  'opencode-go/glm-5.3-flash', 'opencode-go/glm-5.3', 'opencode-go/qwen3.8-flash', 'opencode-go/mimo-v2.6-flash',
  'opencode-go/kimi-k2.7-code', 'opencode-go/gemini-4-argon', 'opencode-go/kimi-k3.1-pro', 'opencode-go/qwen3.8-max',
  'opencode/deepseek-v4.1-flash-free', 'opencode/glm-5.3-flash-free', 'opencode/big-pickle', 'opencode/beam-free',
  'opencode/flint-40b-free',
];
const models = (opt('models') ?? DEFAULT_MODELS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const runs = Number(opt('runs', 2));
const out = resolve(ROOT, opt('out', 'docs/bench/results.json'));
const TIMEOUT = Number(opt('timeout', 120000));

const BUGGY_CODE = `
async function transfer(db, fromId, toId, amount) {
  const from = await db.get('SELECT balance FROM accounts WHERE id = ?', fromId);
  if (from.balance < amount) throw new Error('insufficient funds');
  await db.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', amount, fromId);
  await db.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', amount, toId);
}`;

const TASKS = {
  architect: {
    system: 'You design expert teams. Return ONLY a JSON object, no prose, no markdown fences.',
    prompt: 'Task: "Migrate a Node.js monolith session auth to OAuth2 with refresh tokens across 3 services."\n' +
      'Return {"agents":[{"role":string,"expertise":string,"focus":string}],"executionMode":"parallel"|"sequential","reasoning":string} with 3 to 5 agents with specific roles.',
    check(data) {
      const ok = data && Array.isArray(data.agents) && data.agents.length >= 3 && data.agents.length <= 5
        && data.agents.every(a => typeof a.role === 'string' && typeof a.expertise === 'string')
        && ['parallel', 'sequential'].includes(data.executionMode) && typeof data.reasoning === 'string';
      return { schema: !!ok, correct: !!ok };
    },
  },
  expert: {
    system: 'You are a senior backend engineer reviewing code. Return ONLY a JSON object, no prose.',
    prompt: `Find the most serious correctness bug in this function:\n${BUGGY_CODE}\n` +
      'Return {"bug": string, "category": "race-condition"|"sql-injection"|"null-reference"|"off-by-one"|"none", "fix": string, "confidence": number}.',
    check(data) {
      const schema = data && typeof data.bug === 'string' && typeof data.fix === 'string' && typeof data.category === 'string';
      // Check-then-act without a transaction: concurrent transfers overdraw the account
      const correct = schema && (data.category === 'race-condition' || /transaction|atomic|race|concurren/i.test(data.bug + data.fix));
      return { schema: !!schema, correct: !!correct };
    },
  },
  critic: {
    system: 'You are a strict reviewer. Return ONLY a JSON object, no prose.',
    prompt: `Code:\n${BUGGY_CODE}\nProposal A: "Wrap both UPDATEs and the balance check in one transaction with SELECT ... FOR UPDATE (or a conditional UPDATE ... WHERE balance >= ?) so concurrent transfers cannot overdraw."\n` +
      'Proposal B: "Add input validation that amount is a positive number and log every transfer."\n' +
      'Which proposal fixes the actual defect? Return {"winner":"A"|"B","verdict":string,"score_a":number,"score_b":number}.',
    check(data) {
      const schema = data && (data.winner === 'A' || data.winner === 'B') && typeof data.verdict === 'string';
      return { schema: !!schema, correct: !!schema && data.winner === 'A' };
    },
  },
};

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const results = [];

for (const model of models) {
  const row = { model, calls: 0, failures: 0, json: 0, schema: 0, correct: 0, latencies: [], cost: 0, errors: [], perTask: {} };
  for (const [name, task] of Object.entries(TASKS)) {
    row.perTask[name] = { correct: 0, runs: 0 };
    for (let r = 0; r < runs; r++) {
      row.calls++;
      row.perTask[name].runs++;
      try {
        const res = await complete({ model, system: task.system, prompt: task.prompt, timeoutMs: TIMEOUT });
        row.latencies.push(res.durationMs);
        row.cost += res.cost;
        const parsed = robustParse(res.text);
        if (parsed.success) row.json++;
        const c = task.check(parsed.success ? parsed.data : null);
        if (c.schema) row.schema++;
        if (c.correct) { row.correct++; row.perTask[name].correct++; }
      } catch (err) {
        row.failures++;
        row.errors.push(`${name}: ${String(err.message).slice(0, 160)}`);
        // A provider/quota error will repeat — skip the rest of this model
        if (/usage limit|not available|not allowed|cannot start/i.test(err.message)) break;
      }
    }
    if (row.errors.some(e => /usage limit|not available|not allowed|cannot start/i.test(e))) break;
  }
  row.medianMs = median(row.latencies);
  delete row.latencies;
  results.push(row);
  console.log(`${model.padEnd(36)} ok ${row.correct}/${row.calls}  json ${row.json}  fail ${row.failures}  p50 ${row.medianMs ?? '-'}ms  $${row.cost.toFixed(4)}${row.errors[0] ? '  ! ' + row.errors[0] : ''}`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), runs, results }, null, 2));
console.log(`\nsaved ${out}`);

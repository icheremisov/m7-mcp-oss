// Fork: M7_ALLOWED_ROOTS and the home/root ban apply to every resolution path, not only explicit ones
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const pp = await import(join(ROOT, 'dist/core/utils/projectPath.js'));

const base = realpathSync(mkdtempSync(join(tmpdir(), 'm7-allowed-')));
const allowed = join(base, 'allowed');
const outside = join(base, 'outside');
mkdirSync(join(allowed, 'proj', '.git'), { recursive: true });
mkdirSync(join(outside, '.git'), { recursive: true });

const ENV_KEYS = ['M7_ALLOWED_ROOTS', 'CURSOR_WORKSPACE', 'M7_PROJECT_PATH', 'WORKSPACE_FOLDER_PATHS', 'AGENT_TRANSCRIPTS'];
const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
const prevCwd = process.cwd();

function reset() {
  for (const k of ENV_KEYS) delete process.env[k];
  pp.clearProjectPathCache();
  pp.markRootsResolutionComplete();
}

test.after(() => {
  process.chdir(prevCwd);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(base, { recursive: true, force: true });
});

test('CURSOR_WORKSPACE outside M7_ALLOWED_ROOTS is not used', () => {
  reset();
  process.env.M7_ALLOWED_ROOTS = allowed;
  process.env.CURSOR_WORKSPACE = outside;
  process.chdir(base);
  const p = pp.getProjectPath();
  assert.ok(!p.startsWith(outside), `got ${p}`);
});

test('M7_PROJECT_PATH outside M7_ALLOWED_ROOTS is not used', () => {
  reset();
  process.env.M7_ALLOWED_ROOTS = allowed;
  process.env.M7_PROJECT_PATH = outside;
  process.chdir(base);
  assert.ok(!pp.getProjectPath().startsWith(outside));
});

test('cwd outside M7_ALLOWED_ROOTS falls back to the throwaway placeholder', () => {
  reset();
  process.env.M7_ALLOWED_ROOTS = allowed;
  process.chdir(outside);
  const p = pp.getProjectPath();
  assert.notEqual(realpathSync(p), outside);
  assert.match(p, /m7-no-project-/);
});

test('cwd inside M7_ALLOWED_ROOTS is used', () => {
  reset();
  process.env.M7_ALLOWED_ROOTS = allowed;
  process.chdir(join(allowed, 'proj'));
  assert.equal(realpathSync(pp.getProjectPath()), join(allowed, 'proj'));
});

test('home directory from env is never used', () => {
  reset();
  process.env.CURSOR_WORKSPACE = homedir();
  process.env.M7_PROJECT_PATH = homedir();
  process.chdir(homedir());
  assert.notEqual(pp.getProjectPath(), homedir());
});

test('explicit project_path outside M7_ALLOWED_ROOTS is rejected', () => {
  reset();
  process.env.M7_ALLOWED_ROOTS = allowed;
  assert.throws(() => pp.applyProjectPath(outside), /outside M7_ALLOWED_ROOTS/);
});

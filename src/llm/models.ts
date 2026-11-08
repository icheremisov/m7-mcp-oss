/**
 * Model selection for LLM calls made through the opencode CLI.
 *
 * Resolution order (later wins):
 *   1. preset          — M7_MODEL_PRESET (free | cheap | strong), default "cheap"
 *   2. env per role    — M7_MODEL_<ROLE>, e.g. M7_MODEL_ARCHITECT, M7_MODEL_EXPERTS (comma list)
 *   3. call overrides  — tool arguments (`preset`, `models`) passed from the dialog
 *
 * A model spec is "provider/model" with an optional reasoning variant: "opencode-go/claude-haiku-5-5@high".
 * M7_MODEL_ALLOW (comma-separated globs, e.g. "opencode/*-free,opencode-go/*") limits what may be used.
 *
 * Why these presets: see docs/MODELS.md (benchmark sources and data-retention notes).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type LlmRole = 'classifier' | 'architect' | 'planner' | 'expert' | 'critic' | 'synthesizer' | 'executor';
export type PresetName = 'free' | 'cheap' | 'strong';

export interface ModelAssignment {
  classifier: string;
  architect: string;
  planner: string;
  experts: string[];
  critic: string;
  synthesizer: string;
  executor: string;
}

export type ModelOverrides = Partial<Omit<ModelAssignment, 'experts'>> & {
  experts?: string[];
  preset?: PresetName;
};

export const PRESETS: Record<PresetName, ModelAssignment> = {
  // Zero-retention free models only (mimo-free / big-pickle may train on data, so they are not here).
  free: {
    classifier: 'opencode/deepseek-v4.1-flash-free',
    architect: 'opencode/deepseek-v4.1-flash-free',
    planner: 'opencode/deepseek-v4.1-flash-free',
    experts: ['opencode/deepseek-v4.1-flash-free', 'opencode/glm-5.3-flash-free', 'opencode/beam-free'],
    critic: 'opencode/deepseek-v4.1-flash-free',
    synthesizer: 'opencode/deepseek-v4.1-flash-free',
    executor: 'opencode/glm-5.3-flash-free',
  },
  // OpenCode Go: high request limits, zero retention (Haiku: 30-day retention, no training).
  cheap: {
    classifier: 'opencode-go/deepseek-v4.1-flash',
    architect: 'opencode-go/deepseek-v4.1-flash',
    planner: 'opencode-go/deepseek-v4.1-flash',
    experts: ['opencode-go/deepseek-v4.1-flash', 'opencode-go/claude-haiku-5-5@high', 'opencode-go/glm-5.3-flash'],
    critic: 'opencode-go/glm-5.3-flash',
    synthesizer: 'opencode-go/deepseek-v4.1-flash',
    executor: 'opencode-go/glm-5.3',
  },
  // Strongest per benchmarks, low request limits on Go — use deliberately.
  strong: {
    classifier: 'opencode-go/claude-haiku-5-5',
    architect: 'opencode-go/gemini-4-argon',
    planner: 'opencode-go/gemini-4-argon',
    experts: ['opencode-go/gemini-4-argon', 'opencode-go/kimi-k3.1-pro', 'opencode-go/qwen3.8-max'],
    critic: 'opencode-go/claude-haiku-5-5@high',
    synthesizer: 'opencode-go/gemini-4-argon',
    executor: 'opencode-go/kimi-k3.1-pro',
  },
};

const ROLE_ENV: Record<Exclude<keyof ModelAssignment, 'experts'>, string> = {
  classifier: 'M7_MODEL_CLASSIFIER',
  architect: 'M7_MODEL_ARCHITECT',
  planner: 'M7_MODEL_PLANNER',
  critic: 'M7_MODEL_CRITIC',
  synthesizer: 'M7_MODEL_SYNTHESIZER',
  executor: 'M7_MODEL_EXECUTOR',
};

export function isPresetName(value: unknown): value is PresetName {
  return value === 'free' || value === 'cheap' || value === 'strong';
}

function splitList(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Full role → model table after applying preset, env and per-call overrides. */
export function resolveModels(overrides: ModelOverrides = {}): ModelAssignment {
  const envPreset = process.env.M7_MODEL_PRESET;
  const presetName: PresetName = overrides.preset ?? (isPresetName(envPreset) ? envPreset : 'cheap');
  const result: ModelAssignment = { ...PRESETS[presetName], experts: [...PRESETS[presetName].experts] };

  // M7_MODEL_DEFAULT replaces every single-model role at once
  const def = process.env.M7_MODEL_DEFAULT?.trim();
  for (const role of Object.keys(ROLE_ENV) as Array<keyof typeof ROLE_ENV>) {
    const fromEnv = process.env[ROLE_ENV[role]]?.trim();
    if (fromEnv) result[role] = fromEnv;
    else if (def && !overrides.preset) result[role] = def;
  }
  const envExperts = splitList(process.env.M7_MODEL_EXPERTS);
  if (envExperts.length) result.experts = envExperts;

  // When the dialog picks a preset explicitly, it beats env; explicit per-role overrides beat both
  if (overrides.preset) {
    Object.assign(result, PRESETS[overrides.preset], { experts: [...PRESETS[overrides.preset].experts] });
  }
  for (const role of Object.keys(ROLE_ENV) as Array<keyof typeof ROLE_ENV>) {
    if (overrides[role]) result[role] = overrides[role]!;
  }
  if (overrides.experts?.length) result.experts = overrides.experts;
  return result;
}

export function modelForRole(role: LlmRole, overrides: ModelOverrides = {}, index = 0): string {
  const table = resolveModels(overrides);
  if (role === 'expert') return table.experts[index % table.experts.length];
  return table[role];
}

export function parseModelSpec(spec: string): { model: string; variant?: string } {
  const at = spec.lastIndexOf('@');
  if (at > 0) return { model: spec.slice(0, at), variant: spec.slice(at + 1) };
  return { model: spec };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Throws if the model is outside M7_MODEL_ALLOW. */
export function assertAllowed(spec: string): void {
  const allow = splitList(process.env.M7_MODEL_ALLOW);
  if (allow.length === 0) return;
  const { model } = parseModelSpec(spec);
  if (!allow.some(g => globToRegExp(g).test(model))) {
    throw new Error(`Model "${model}" is not allowed by M7_MODEL_ALLOW (${allow.join(', ')})`);
  }
}

let availableCache: { at: number; models: string[] } | null = null;
const AVAILABLE_TTL_MS = 10 * 60 * 1000;

/** Models the local opencode can use (`opencode models`), cached for 10 minutes. */
export async function listAvailableModels(force = false): Promise<string[]> {
  if (!force && availableCache && Date.now() - availableCache.at < AVAILABLE_TTL_MS) {
    return availableCache.models;
  }
  const bin = process.env.M7_OPENCODE_BIN || 'opencode';
  const { stdout } = await execFileAsync(bin, ['models'], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const models = stdout.split('\n').map(s => s.trim()).filter(s => /^[\w.-]+\/\S+$/.test(s));
  availableCache = { at: Date.now(), models };
  return models;
}

/** Validates allowlist and existence in `opencode models`; returns the spec unchanged. */
export async function validateModel(spec: string): Promise<string> {
  assertAllowed(spec);
  const { model } = parseModelSpec(spec);
  const available = await listAvailableModels().catch(() => null);
  if (available && available.length && !available.includes(model)) {
    throw new Error(`Model "${model}" is not available in opencode (see \`opencode models\`)`);
  }
  return spec;
}

export function modelTier(model: string): 'free' | 'go' | 'local' | 'other' {
  if (/^opencode\/.*(-free|big-pickle)/.test(model)) return 'free';
  if (model.startsWith('opencode-go/')) return 'go';
  if (/^(lmstudio|ollama)\//.test(model)) return 'local';
  return 'other';
}

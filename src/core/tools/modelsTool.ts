/**
 * mcp_m7_models — which opencode models M7 uses per role, and which are available.
 * Lets the user pick models "from the dialog": the agent reads this, then passes
 * `preset` / `models` to mcp_m7_hive_coordinator.
 */

import { z } from 'zod';
import { createLogger } from '../utils/logger.js';
import {
  PRESETS, resolveModels, listAvailableModels, modelTier, isPresetName, ModelAssignment,
} from '../../llm/index.js';

const log = createLogger('[models]');

const ModelsRequestSchema = z.object({
  action: z.enum(['current', 'presets', 'available']).default('current')
    .describe('"current" — role → model table now in effect; "presets" — all presets; "available" — models from `opencode models` grouped by tier'),
  preset: z.enum(['free', 'cheap', 'strong']).optional().describe('Show the table as it would be with this preset'),
});

function formatTable(table: ModelAssignment): string {
  const rows = [
    ['classifier (fallback after jev)', table.classifier],
    ['architect', table.architect],
    ['planner', table.planner],
    ['experts', table.experts.join(', ')],
    ['critic', table.critic],
    ['synthesizer', table.synthesizer],
    ['executor', table.executor],
  ];
  return ['| Role | Model |', '|---|---|', ...rows.map(([r, m]) => `| ${r} | \`${m}\` |`)].join('\n');
}

export const modelsTool = {
  name: 'mcp_m7_models',
  description: `Show which opencode models M7 uses for each LLM role (intent classifier, Hive architect/planner/experts/critic/synthesizer/executor) and which models are available locally.
Use it before mcp_m7_hive_coordinator when the user wants to choose models: pass the chosen preset ("free" | "cheap" | "strong") or explicit "models" there.
Intent classification uses jev (OpenCode Zen System One) first; set M7_CLASSIFIER=opencode|off to change.`,
  inputSchema: ModelsRequestSchema,
  handler: async (request: any) => {
    const params = ModelsRequestSchema.parse(request ?? {});
    const envPreset = process.env.M7_MODEL_PRESET;
    const activePreset = params.preset ?? (isPresetName(envPreset) ? envPreset : 'cheap');

    if (params.action === 'presets') {
      return Object.entries(PRESETS)
        .map(([name, table]) => `### ${name}${name === activePreset ? ' (active)' : ''}\n${formatTable(table)}`)
        .join('\n\n');
    }

    if (params.action === 'available') {
      try {
        const models = await listAvailableModels(true);
        const groups: Record<string, string[]> = {};
        for (const m of models) (groups[modelTier(m)] ??= []).push(m);
        const allow = process.env.M7_MODEL_ALLOW ? `\nM7_MODEL_ALLOW: \`${process.env.M7_MODEL_ALLOW}\`` : '';
        return Object.entries(groups)
          .map(([tier, list]) => `### ${tier} (${list.length})\n${list.map(m => `- \`${m}\``).join('\n')}`)
          .join('\n\n') + allow;
      } catch (err: any) {
        log.debug(`opencode models failed: ${err.message}`);
        return { content: [{ type: 'text', text: `❌ Cannot list opencode models: ${err.message}` }], isError: true };
      }
    }

    const table = resolveModels(params.preset ? { preset: params.preset } : {});
    return `## M7 models (preset: ${activePreset})\n\n${formatTable(table)}\n\n` +
      'Override per call: mcp_m7_hive_coordinator `preset` / `models`. Defaults: env M7_MODEL_PRESET, M7_MODEL_<ROLE>, M7_MODEL_EXPERTS. Details: docs/MODELS.md';
  },
};

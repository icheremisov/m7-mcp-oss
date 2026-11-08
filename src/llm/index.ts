/**
 * Single LLM entry point for M7. All model calls go through the local opencode CLI
 * (no OpenAI / Anthropic SDKs, no API keys in the MCP config).
 */

import { complete, CompleteResult } from './opencode.js';
import { modelForRole, LlmRole, ModelOverrides } from './models.js';

export * from './models.js';
export { complete } from './opencode.js';
export type { CompleteRequest, CompleteResult } from './opencode.js';
export { askJev, argmax } from './jev.js';
export type { JevQuestion, JevAnswer } from './jev.js';

export interface RoleCompleteRequest {
  role: LlmRole;
  system?: string;
  prompt: string;
  /** Explicit model spec; otherwise resolved from role + overrides */
  model?: string;
  overrides?: ModelOverrides;
  /** Index among experts (role "expert") to spread across model families */
  expertIndex?: number;
  timeoutMs?: number;
}

/** Complete with the model assigned to a role. */
export function completeForRole(req: RoleCompleteRequest): Promise<CompleteResult> {
  const model = req.model ?? modelForRole(req.role, req.overrides, req.expertIndex ?? 0);
  return complete({ model, system: req.system, prompt: req.prompt, timeoutMs: req.timeoutMs });
}

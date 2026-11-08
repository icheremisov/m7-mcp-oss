/**
 * M7 Hive - Model Selector
 *
 * Assigns a model to each dynamic agent from the opencode adapter's model table
 * (src/llm): agent i gets role "expert" with expertIndex i, so a team is spread
 * across the different model families of the active preset / overrides.
 */

import { DynamicAgent, ModelSelection } from './types.js';
import { modelForRole, ModelOverrides } from '../../llm/index.js';
import { silentLogger as logger } from '../../core/utils/logger.js';

function providerOf(spec: string): string {
  const slash = spec.indexOf('/');
  return slash > 0 ? spec.slice(0, slash) : spec;
}

export class ModelSelector {
  constructor(private overrides: ModelOverrides = {}) {}

  /** Model for the agent at position `expertIndex` in the team */
  selectModelForAgent(agent: DynamicAgent, expertIndex = 0): ModelSelection {
    const model = modelForRole('expert', this.overrides, expertIndex);
    return {
      model,
      provider: providerOf(model),
      expertIndex,
      reasoning: `expert #${expertIndex} from opencode model table for "${agent.role}"`
    };
  }

  /** Select models for an entire team (keyed by agent id) */
  selectModelsForTeam(agents: DynamicAgent[]): Map<string, ModelSelection> {
    const selections = new Map<string, ModelSelection>();
    agents.forEach((agent, i) => selections.set(agent.id, this.selectModelForAgent(agent, i)));

    logger.info(`[Model Selector] 📋 Team model assignments:`);
    for (const agent of agents) {
      logger.info(`  - ${agent.role}: ${selections.get(agent.id)!.model}`);
    }
    return selections;
  }
}

export function createModelSelector(overrides: ModelOverrides = {}): ModelSelector {
  return new ModelSelector(overrides);
}

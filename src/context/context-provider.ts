/**
 * M7 v3.1 - Context Provider
 * 
 * Provides current time and the models M7 uses per role (from the opencode
 * adapter's resolved model table — no network calls, no API keys).
 */

import { resolveModels } from '../llm/index.js';
import {
  CurrentContext,
  AvailableModels,
  ModelInfo,
  ContextProviderConfig,
  DEFAULT_CONTEXT_CONFIG,
} from './types.js';

/**
 * Context Provider - provides time and model context for AI
 */
export class ContextProvider {
  private config: ContextProviderConfig;

  constructor(config?: Partial<ContextProviderConfig>) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

  /**
   * Get current context (time + models)
   */
  async getContext(): Promise<CurrentContext> {
    const time = this.getCurrentTime();
    const models = await this.getAvailableModels();
    if (!this.config.enabled) {
      return { timestamp: time.timestamp, formattedTime: time.formatted, models, header: '' };
    }

    return {
      timestamp: time.timestamp,
      formattedTime: time.formatted,
      models,
      header: this.buildHeader(time.formatted, models),
    };
  }

  /**
   * Get current time
   */
  getCurrentTime(): { timestamp: string; formatted: string } {
    const now = new Date();
    return {
      timestamp: now.toISOString(),
      formatted: now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    };
  }

  /**
   * Current role → model table (preset + env overrides), resolved locally
   */
  async getAvailableModels(): Promise<AvailableModels> {
    const table = resolveModels();
    const roles: ModelInfo[] = [
      { name: 'classifier', id: table.classifier },
      { name: 'architect', id: table.architect },
      { name: 'planner', id: table.planner },
      ...table.experts.map((id, i) => ({ name: `expert[${i}]`, id })),
      { name: 'critic', id: table.critic },
      { name: 'synthesizer', id: table.synthesizer },
      { name: 'executor', id: table.executor },
    ];
    return { roles, lastUpdated: new Date().toISOString() };
  }

  /**
   * Build Markdown header for injection
   */
  buildHeader(formattedTime: string, models: AvailableModels): string {
    const roleLines = models.roles.map(m => `   **${m.name}:** ${m.id}`).join('\n');

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 **CURRENT CONTEXT**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕐 **Time:** ${formattedTime}
⚠️ *Your dataset is ~1 year behind. Always verify versions!*

🤖 **M7 models per role (opencode):**
${roleLines}

💡 *Use Context7 to verify library versions!*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
let instance: ContextProvider | null = null;

/**
 * Get ContextProvider singleton
 */
export function getContextProvider(): ContextProvider {
  if (!instance) {
    instance = new ContextProvider();
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetContextProvider(): void {
  instance = null;
}


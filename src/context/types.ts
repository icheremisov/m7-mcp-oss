/**
 * M7 v3.1 - Context Provider Types
 * 
 * Types for time and model context injection
 */

/**
 * Current context returned by ContextProvider
 */
export interface CurrentContext {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Human-readable formatted time */
  formattedTime: string;
  /** Models M7 currently uses per role (opencode adapter) */
  models: AvailableModels;
  /** Pre-built Markdown header for injection */
  header: string;
}

/**
 * Current role → model table of the opencode adapter (src/llm), no network involved
 */
export interface AvailableModels {
  /** One entry per role (experts are listed individually as expert[0], expert[1], ...) */
  roles: ModelInfo[];
  /** ISO timestamp when the table was resolved */
  lastUpdated: string;
}

/**
 * Model assigned to a role
 */
export interface ModelInfo {
  /** opencode model spec, e.g. "opencode-go/deepseek-v4.1-flash" or "...@high" */
  id: string;
  /** Role label, e.g. "architect", "expert[1]" */
  name: string;
}

/**
 * Context Provider configuration
 */
export interface ContextProviderConfig {
  /** Enable context injection */
  enabled: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CONTEXT_CONFIG: ContextProviderConfig = {
  enabled: true,
};

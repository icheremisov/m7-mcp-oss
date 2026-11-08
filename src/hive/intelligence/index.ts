/**
 * M7 Hive v2.0 - Dynamic Intelligence Module
 * 
 * Exports all components for dynamic agent generation and model assignment.
 * 
 * @version 3.7.0
 */

// Types
export * from './types.js';

// Hive Architect
export { HiveArchitect, createHiveArchitect } from './hiveArchitect.js';

// Model Selector
export { ModelSelector, createModelSelector } from './modelSelector.js';

// Self-Learning
export {
  logExecution,
  readExecutionLogs,
  recalculateAdjustments,
  getLearningAdjustments,
  getLearningState,
  addUserRating,
  clearLearningData,
  getLearningStats
} from './selfLearning.js';

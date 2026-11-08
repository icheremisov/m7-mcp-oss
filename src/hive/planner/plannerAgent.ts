/**
 * M7 Hive v3.0 - Planner Agent
 * 
 * Uses the "planner" role model (opencode adapter, src/llm) to decompose high-level goals into subtasks
 * with dependencies for CNP auction-based execution.
 * 
 * @version 3.8.0
 */

import { randomUUID } from 'crypto';
// v5.1: Use robust JSON parser
import { robustParse } from '../utils/json/index.js';
import { 
  CNPTask, 
  CNPConstraints, 
  createCNPTask 
} from './types.js';
import { createLogger } from '../../core/utils/logger.js';
const log = createLogger('[PlannerAgent]');
import { completeForRole, ModelOverrides } from '../../llm/index.js';

/**
 * Planner Agent - Decomposes goals into executable subtasks
 */
export class PlannerAgent {
  constructor(private overrides: ModelOverrides = {}) {
    log.info('[Planner] ✅ Initialized');
  }
  
  /**
   * Decompose a high-level goal into CNP tasks
   */
  async decompose(
    goal: string,
    context?: Record<string, any>,
    constraints?: Partial<CNPConstraints>
  ): Promise<{ tasks: CNPTask[]; reasoning: string }> {
    
    const startTime = Date.now();
    log.debug(`[PlannerAgent] 🎯 Decomposing goal: ${goal.substring(0, 80)}...`);
    log.info(`[Planner] 🎯 Decomposing goal: ${goal.substring(0, 80)}...`);
    
    try {
      const response = await completeForRole({
        role: 'planner',
        overrides: this.overrides,
        system: this.getSystemPrompt(),
        prompt: this.buildPrompt(goal, context, constraints) + '\n\nReturn only the JSON, no prose before or after it.'
      });
      log.debug(`[PlannerAgent] ${response.model} responded in ${response.durationMs}ms`);
      
      const content = response.text;
      log.debug(`[PlannerAgent] Got response, parsing... (${content.substring(0, 100)}...)`);
      const result = this.parseResponse(content, goal);
      
      const latency = Date.now() - startTime;
      log.debug(`[PlannerAgent] ✅ Created ${result.tasks.length} tasks in ${latency}ms`);
      log.info(`[Planner] ✅ Created ${result.tasks.length} tasks in ${latency}ms`);
      
      return result;
      
    } catch (error: any) {
      log.debug(`[PlannerAgent] ❌ Decomposition failed: ${error.message}`);
      log.debug(`[PlannerAgent] Error details: ${JSON.stringify(error)}`);
      log.error(`[Planner] ❌ Decomposition failed: ${error.message}`);
      
      // Fallback: single task
      return {
        tasks: [createCNPTask(goal, 'goal', { priority: 100 })],
        reasoning: 'Fallback: single task due to decomposition failure'
      };
    }
  }
  
  private getSystemPrompt(): string {
    return `You are the Hive Planner - you decompose complex goals into actionable subtasks.

## Your Role

1. Analyze the goal and break it into 2-8 specific subtasks
2. Identify dependencies between tasks (what must complete first)
3. Assign appropriate constraints and priorities
4. Create review tasks for critical outputs

## Task Types

- **subtask**: A concrete piece of work
- **review**: Quality/security review of another task's output
- **fix**: Correction task when review fails

## Priority Scale

- 100: Critical path, blocks everything
- 80-99: High priority
- 50-79: Normal priority
- 20-49: Low priority, can be deferred

## Output Format

Respond with valid JSON only:
{
  "subtasks": [
    {
      "description": "Specific, actionable task description",
      "type": "subtask",
      "dependencies": [],  // Array of subtask indices (0-based)
      "priority": 80,
      "constraints": {
        "requiredCapabilities": ["coding"],
        "maxTimeMs": 60000
      }
    }
  ],
  "reasoning": "Why this decomposition makes sense"
}

## Rules

1. Each task must be independently executable
2. Dependencies form a DAG (no cycles)
3. Critical tasks need review tasks
4. Be specific - "Implement X" not "Do stuff"`;
  }
  
  private buildPrompt(
    goal: string,
    context?: Record<string, any>,
    constraints?: Partial<CNPConstraints>
  ): string {
    let prompt = `## Goal to Decompose

${goal}

## Instructions

Break this goal into specific, actionable subtasks. Consider:
1. What must be done first? (dependencies)
2. What requires security/quality review?
3. What can be done in parallel?
4. What are the critical path items?`;

    if (context) {
      prompt += `\n\n## Additional Context\n${JSON.stringify(context, null, 2)}`;
    }
    
    if (constraints) {
      prompt += `\n\n## Global Constraints\n${JSON.stringify(constraints, null, 2)}`;
    }
    
    return prompt;
  }
  
  private parseResponse(
    content: string, 
    originalGoal: string
  ): { tasks: CNPTask[]; reasoning: string } {
    
    try {
      // v5.1: Use robust JSON parser with extraction and recovery
      const result = robustParse(content);
      if (!result.success || !result.data) {
        throw new Error(result.error || 'No JSON found');
      }
      
      const parsed = result.data as any;
      const now = new Date().toISOString();
      
      // Create root goal task
      const rootTask = createCNPTask(originalGoal, 'goal', {
        id: `goal_${randomUUID()}`,
        priority: 100,
        createdAt: now,
        updatedAt: now
      });
      
      // Create subtasks
      const subtasks: CNPTask[] = (parsed.subtasks || []).map((st: any, idx: number) => {
        const task = createCNPTask(st.description, st.type || 'subtask', {
          id: `subtask_${randomUUID()}`,
          parentId: rootTask.id,
          priority: st.priority || 50,
          constraints: st.constraints || {},
          // Store raw dependency indices for resolution
          dependencies: (st.dependencies || []).map((d: number) => `__idx_${d}`),
          createdAt: now,
          updatedAt: now
        });
        return task;
      });
      
      // Resolve dependency indices to task IDs
      for (const task of subtasks) {
        task.dependencies = task.dependencies.map(dep => {
          if (dep.startsWith('__idx_')) {
            const idx = parseInt(dep.replace('__idx_', ''));
            return subtasks[idx]?.id || '';
          }
          return dep;
        }).filter(Boolean);
      }
      
      // Update root task with all subtask IDs as implicit dependencies
      // (root completes when all subtasks complete)
      
      return {
        tasks: [rootTask, ...subtasks],
        reasoning: parsed.reasoning || 'Goal decomposed into subtasks'
      };
      
    } catch (error: any) {
      log.warn(`[Planner] Parse failed: ${error.message}, using fallback`);
      
      return {
        tasks: [createCNPTask(originalGoal, 'goal', { priority: 100 })],
        reasoning: 'Fallback: single task due to parse failure'
      };
    }
  }
  
  /**
   * Get execution order respecting dependencies
   */
  getExecutionOrder(tasks: CNPTask[]): CNPTask[][] {
    const completed = new Set<string>();
    const remaining = new Map(tasks.map(t => [t.id, t]));
    const waves: CNPTask[][] = [];
    
    while (remaining.size > 0) {
      const wave: CNPTask[] = [];
      
      for (const [id, task] of remaining) {
        const depsComplete = task.dependencies.every(d => completed.has(d));
        if (depsComplete) {
          wave.push(task);
        }
      }
      
      if (wave.length === 0 && remaining.size > 0) {
        // Circular dependency detected, break it
        log.warn('[Planner] Circular dependency detected, forcing execution');
        const entry = remaining.entries().next();
        if (!entry.done && entry.value) {
          const [, firstTask] = entry.value;
          wave.push(firstTask);
        }
      }
      
      for (const task of wave) {
        remaining.delete(task.id);
        completed.add(task.id);
      }
      
      if (wave.length > 0) {
        waves.push(wave);
      }
    }
    
    return waves;
  }
  
  /**
   * Add a review task for an existing task
   */
  createReviewTask(
    targetTask: CNPTask,
    reviewType: 'security' | 'quality' | 'architecture'
  ): CNPTask {
    return createCNPTask(
      `${reviewType.charAt(0).toUpperCase() + reviewType.slice(1)} review: ${targetTask.description}`,
      'review',
      {
        parentId: targetTask.parentId,
        dependencies: [targetTask.id],
        priority: Math.min(100, targetTask.priority + 10), // Slightly higher priority
        constraints: {
          requiredCapabilities: [reviewType === 'architecture' ? 'architecture' : 'security'],
          maxTimeMs: 30000
        }
      }
    );
  }
  
  /**
   * Add a fix task when review fails
   */
  createFixTask(
    targetTask: CNPTask,
    reviewTask: CNPTask,
    issues: string[]
  ): CNPTask {
    return createCNPTask(
      `Fix issues in "${targetTask.description}": ${issues.join(', ')}`,
      'fix',
      {
        parentId: targetTask.parentId,
        dependencies: [reviewTask.id],
        priority: targetTask.priority + 5, // Higher priority to unblock
        constraints: targetTask.constraints,
        context: {
          originalTaskId: targetTask.id,
          reviewTaskId: reviewTask.id,
          issues
        }
      } as any
    );
  }
}

/**
 * Create Planner Agent instance
 */
export function createPlannerAgent(overrides: ModelOverrides = {}): PlannerAgent {
  return new PlannerAgent(overrides);
}

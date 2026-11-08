import { AgentType, AgentConfig, AgentContext, AgentResponse, AgentProposal } from '../types/agent.js';
import { RequestMetrics } from '../types/api.js';
import { silentLogger as logger } from '../../core/utils/logger.js';
import { parseLegacyAgentResponse } from '../utils/json/index.js';
import { withRetry, classifyError, RetryConfig, formatRetryResult } from '../../core/utils/retry.js';
import { guardContext, analyzeContext, formatAnalysis, ContextGuardConfig, DEFAULT_CONTEXT_GUARD_CONFIG } from '../context/index.js';
import { completeForRole, modelForRole, ModelOverrides } from '../../llm/index.js';

/** Order defines each fixed agent's expertIndex (spreads agents across model families). */
const AGENT_ORDER: AgentType[] = ['research', 'implementation', 'architecture', 'security', 'testing', 'performance', 'techsafety'];

/**
 * Runs the legacy "fixed" mode agents through the opencode adapter (src/llm).
 * Each agent type uses role "expert" with its own expertIndex.
 */
export class APIManager {
  private metrics: RequestMetrics[] = [];
  private overrides: ModelOverrides;
  
  // v3.10: Context guard configuration
  private contextGuardConfig: ContextGuardConfig = {
    ...DEFAULT_CONTEXT_GUARD_CONFIG,
    warningThreshold: 80,
    errorThreshold: 95,
    autoTruncate: true,
    logUsage: true,
  };
  
  // v3.10: Retry configuration
  private retryConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    jitter: 0.1,
    backoffMultiplier: 2,
    onRetry: (attempt, error, delayMs) => {
      const classified = classifyError(error);
      logger.warn(
        `[Hive API] Retry ${attempt}: [${classified.code}] ${classified.message}, ` +
        `waiting ${Math.round(delayMs)}ms...`
      );
    },
  };
  
  private agentConfigs: Record<AgentType, AgentConfig> = {
    research: {
      id: 'research',
      specialization: 'Deep research, analysis, documentation',
      strengths: ['thorough_analysis', 'context_understanding', 'research'],
      cost_tier: 'premium'
    },
    implementation: {
      id: 'implementation',
      specialization: 'Fast coding, optimization, debugging',
      strengths: ['code_generation', 'optimization', 'debugging'],
      cost_tier: 'premium'
    },
    architecture: {
      id: 'architecture',
      specialization: 'System design, technical architecture',
      strengths: ['structured_thinking', 'technical_depth', 'patterns'],
      cost_tier: 'premium'
    },
    security: {
      id: 'security',
      specialization: 'Security audit, vulnerabilities, RLS',
      strengths: ['security_awareness', 'risk_analysis', 'careful_reasoning'],
      cost_tier: 'premium'
    },
    testing: {
      id: 'testing',
      specialization: 'Test generation, validation, QA',
      strengths: ['edge_cases', 'comprehensive_testing', 'quality'],
      cost_tier: 'standard'
    },
    performance: {
      id: 'performance',
      specialization: 'Performance optimization, metrics',
      strengths: ['efficiency', 'fast_analysis', 'optimization'],
      cost_tier: 'standard'
    },
    techsafety: {
      id: 'techsafety',
      specialization: 'AI-safe technology assessment, risk analysis',
      strengths: ['technology_awareness', 'risk_assessment', 'alternatives'],
      cost_tier: 'premium'
    }
  };
  
  constructor(overrides: ModelOverrides = {}) {
    this.overrides = overrides;
  }
  
  /**
   * Current model spec for an agent (resolved from preset / overrides)
   */
  getAgentModel(agentType: AgentType): string {
    return modelForRole('expert', this.overrides, AGENT_ORDER.indexOf(agentType));
  }
  
  async callAgent(
    agentType: AgentType,
    prompt: string,
    context: AgentContext
  ): Promise<AgentResponse> {
    
    const config = this.agentConfigs[agentType];
    const model = this.getAgentModel(agentType);
    const startTime = Date.now();
    
    // v3.10: Apply context window guard
    const guardResult = guardContext(prompt, model, {
      config: this.contextGuardConfig,
    });
    
    // Use guarded (potentially truncated) prompt
    const safePrompt = guardResult.content;
    
    if (guardResult.truncated) {
      logger.warn(
        `[Hive API] Context truncated: ${guardResult.originalTokens} → ${guardResult.finalTokens} tokens ` +
        `(${guardResult.strategy} strategy, removed ${guardResult.tokensRemoved})`
      );
    } else if (guardResult.warnings.length > 0) {
      // Log warnings even if not truncated
      guardResult.warnings.forEach(w => logger.warn(`[Hive API] ${w}`));
    }
    
    // v3.10: Use intelligent retry with exponential backoff
    const retryResult = await withRetry(
      () => this.callModel(agentType, config, safePrompt, context),
      this.retryConfig
    );
    
    if (retryResult.success && retryResult.data) {
      const apiResponse = retryResult.data;
      
      // Parse response into AgentProposal
      const proposal = await this.parseAgentResponse(agentType, apiResponse.content);
      
      // Track metrics (including retry and failover info)
      this.trackMetrics({
        agent: agentType,
        model,
        tokens_input: Math.ceil(prompt.length / 4),
        tokens_output: apiResponse.tokens_used,
        cost: apiResponse.cost_estimate,
        latency: Date.now() - startTime,
        success: true,
        retryAttempts: retryResult.attempts,
        retryDelayMs: retryResult.totalDelayMs,
      });
      
      // Log if retries were needed
      if (retryResult.attempts > 1) {
        logger.info(`[Hive API] ${formatRetryResult(retryResult)}`);
      }
      
      return {
        success: true,
        proposal,
        tokens_used: apiResponse.tokens_used,
        cost_estimate: apiResponse.cost_estimate
      };
      
    } else {
      // All retries failed
      const errorMsg = retryResult.error 
        ? `[${retryResult.error.code}] ${retryResult.error.message}`
        : 'Unknown API error';
      
      logger.error(`[Hive API] ${formatRetryResult(retryResult)}`);
      
      this.trackMetrics({
        agent: agentType,
        model,
        tokens_input: Math.ceil(prompt.length / 4),
        tokens_output: 0,
        cost: 0,
        latency: Date.now() - startTime,
        success: false,
        retryAttempts: retryResult.attempts,
        retryDelayMs: retryResult.totalDelayMs,
      });
      
      return {
        success: false,
        error: errorMsg
      };
    }
  }
  
  /**
   * v3.10: Analyze context before sending to API
   */
  analyzePromptContext(prompt: string, model?: string) {
    const targetModel = model || this.getAgentModel('research');
    const analysis = analyzeContext(prompt, targetModel);
    return {
      ...analysis,
      formatted: formatAnalysis(analysis),
    };
  }
  
  /**
   * v3.10: Configure context guard settings
   */
  setContextGuardConfig(config: Partial<ContextGuardConfig>): void {
    this.contextGuardConfig = { ...this.contextGuardConfig, ...config };
    logger.info('[Hive API] Context guard config updated');
  }
  
  private async callModel(
    agentType: AgentType,
    config: AgentConfig,
    prompt: string,
    context: AgentContext
  ) {
    const result = await completeForRole({
      role: 'expert',
      expertIndex: AGENT_ORDER.indexOf(agentType),
      overrides: this.overrides,
      system: this.buildSystemPrompt(config, context),
      prompt
    });
    logger.info(`[Hive API] ${config.id} agent → ${result.model} (${result.tokens.total} tokens, ${result.durationMs}ms)`);
    return {
      content: result.text,
      tokens_used: result.tokens.total,
      cost_estimate: result.cost,
      response_time: result.durationMs
    };
  }
  
  private buildSystemPrompt(config: AgentConfig, context: AgentContext): string {
    return `You are a ${config.specialization} specialist working as part of the M7 Hive multiagent system.

Your Role: ${config.specialization}
Your Strengths: ${config.strengths.join(', ')}

Task Context: ${context.task}
${context.existing_code ? `Existing Code Context: ${context.existing_code}` : ''}
${context.constraints ? `Constraints: ${context.constraints.join(', ')}` : ''}

Instructions:
1. Analyze the task from your specialized perspective
2. Provide a detailed proposal with reasoning
3. Include implementation steps, requirements, and risks
4. Format your response as valid JSON with this structure:
{
  "proposal": "Your main solution/approach",
  "reasoning": "Why this approach is optimal", 
  "confidence": 0.8,
  "implementation_steps": ["step1", "step2"],
  "requirements": ["req1", "req2"],
  "risks": ["risk1", "risk2"],
  "alternatives": ["alt1", "alt2"],
  "estimated_time": "2-4 hours"
}
Return only the JSON object, no prose before or after it.

Focus on your specialization but consider the broader system context.`;
  }
  
  private async parseAgentResponse(agentType: AgentType, content: string): Promise<AgentProposal> {
    // Use robust JSON parser with extraction, repair, and recovery
    return parseLegacyAgentResponse(agentType, content);
  }
  
  private trackMetrics(metrics: RequestMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last 1000 requests
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }
  
  getMetrics(): RequestMetrics[] {
    return [...this.metrics];
  }
  
  getTotalCost(): number {
    return this.metrics.reduce((sum, m) => sum + m.cost, 0);
  }
}

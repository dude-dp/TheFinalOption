import { AIManager } from './ai-manager.js';
import { TradingDecision, AIAction } from './types.js';
import { logInfo, logWarn, logError } from '../logger.js';

export interface EnsembleResult {
  decision: TradingDecision;
  votes: {
    modelId: string;
    action: AIAction;
    confidence: number;
    reasoning: string;
    latencyMs: number;
  }[];
}

export class EnsembleEngine {
  /**
   * Executes the prompt against 3 independent models and returns a consensus.
   * @param requiredVotes Default is 2 (Majority rules)
   */
  public static async getConsensus(prompt: string, requiredVotes: number = 2): Promise<EnsembleResult> {
    const healthyModels = AIManager.getHealthyModels();

    if (healthyModels.length < 3) {
      logWarn('[ENSEMBLE] ⚠️ Less than 3 healthy models available. Proceeding with degraded ensemble.');
    }

    // Pick top 3 available models
    const targetModels = healthyModels.slice(0, 3);
    if (targetModels.length === 0) {
       return this.emergencyFallback('No healthy models available for ensemble voting.');
    }

    logInfo(`[ENSEMBLE] 🚀 Firing parallel requests to: ${targetModels.map(m => m.name || m.id).join(' | ')}`);

    // Execute concurrent HTTP requests
    const promises = targetModels.map(model => AIManager.askSpecificModel(prompt, model.id));
    const results = await Promise.allSettled(promises);

    const votes: EnsembleResult['votes'] = [];
    const actionCounts: Record<AIAction, number> = { BUY_CE: 0, BUY_PE: 0, WAIT: 0 };
    const actionConfidence: Record<AIAction, number[]> = { BUY_CE: [], BUY_PE: [], WAIT: [] };

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const modelId = targetModels[i].id;

      if (res.status === 'fulfilled' && res.value.parsed) {
        const decision = res.value.parsed;
        votes.push({
          modelId,
          action: decision.action,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          latencyMs: res.value.latencyMs
        });

        actionCounts[decision.action]++;
        actionConfidence[decision.action].push(decision.confidence);
      } else {
         const errorMsg = res.status === 'fulfilled' ? res.value.error : res.reason;
         logWarn(`[ENSEMBLE] ❌ Model ${modelId} failed to return a valid vote. Error: ${errorMsg}`);
      }
    }

    // Tally the votes
    let winningAction: AIAction = 'WAIT';
    let consensusReasoning = 'No consensus reached. Defaulting to WAIT.';
    let avgConfidence = 0;
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'HIGH';

    if (actionCounts.BUY_CE >= requiredVotes) {
      winningAction = 'BUY_CE';
    } else if (actionCounts.BUY_PE >= requiredVotes) {
      winningAction = 'BUY_PE';
    }

    // Calculate aggregated confidence and generate reasoning string
    if (winningAction !== 'WAIT') {
       const confidences = actionConfidence[winningAction];
       avgConfidence = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
       riskLevel = 'MEDIUM'; 
       
       const winningVotes = votes.filter(v => v.action === winningAction);
       consensusReasoning = winningVotes.map(v => `[${v.modelId.split('/')[1]}]: ${v.reasoning}`).join(' || ');
       
       logInfo(`[ENSEMBLE] ✅ CONSENSUS REACHED: ${winningAction} | Votes: ${actionCounts[winningAction]}/3 | Avg Confidence: ${avgConfidence}%`);
    } else {
       // If WAIT won, or if it was a 1-1-1 split
       avgConfidence = actionConfidence.WAIT.length > 0 
         ? Math.round(actionConfidence.WAIT.reduce((a, b) => a + b, 0) / actionConfidence.WAIT.length) 
         : 0;
       logInfo(`[ENSEMBLE] ⏸️ Voting resulted in WAIT or a hung jury. No trade taken.`);
    }

    return {
      decision: {
        action: winningAction,
        confidence: avgConfidence,
        reasoning: consensusReasoning,
        risk_level: riskLevel
      },
      votes
    };
  }

  private static emergencyFallback(reason: string): EnsembleResult {
    return {
      decision: {
        action: 'WAIT',
        confidence: 0,
        reasoning: reason,
        risk_level: 'HIGH'
      },
      votes: []
    };
  }
}

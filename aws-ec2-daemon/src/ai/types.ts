export interface AIModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string | number;
    completion: string | number;
  };
}

export interface AIResponse {
  content: string;
  modelUsed: string;
  latencyMs: number;
  error?: string;
}

export type AIAction = 'BUY_CE' | 'BUY_PE' | 'WAIT';

export interface TradingDecision {
  action: AIAction;
  confidence: number;      // 0-100 scale for ensemble voting weights
  reasoning: string;       // Strict 1-2 sentence explanation for the UI Terminal
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

import { randomUUID } from 'node:crypto';
import type { InverseSignals } from './inverse-growth.js';

export type PricingFormula = {
  beta: number; gamma: number; delta: number; epsilon: number;
  maxUplift: number; version: string;
};

export type ValuationInput = {
  referencePrice: number;
  upliftFactor: number;
  signals: InverseSignals;
  consentAuthorized: boolean;
  buyerAuthorized: boolean;
};

export class InversePricingEngine {
  private formula: PricingFormula = {
    beta: 1, gamma: 1, delta: 1, epsilon: 1, maxUplift: 0.25, version: 'pricing-rd-2.0.0',
  };
  private completed = 0;
  private denied = 0;
  private totalEstimate = 0;
  private lastRunAt: string | null = null;
  private audit: Array<{ id: string; type: string; actor: string; createdAt: string; details: Record<string, unknown> }> = [];

  quote(input: ValuationInput) {
    const result = this.calculate(input);
    queueMicrotask(() => this.recordResult(result));
    return result;
  }

  private calculate(input: ValuationInput) {
    const eligible = input.consentAuthorized && input.buyerAuthorized;
    const bounded = (value: number) => Math.max(0, Math.min(1, value));
    const s = {
      PRI: bounded(input.signals.PRI), BDI: bounded(input.signals.BDI),
      SSI: bounded(input.signals.SSI), MRI: bounded(input.signals.MRI), QLI: bounded(input.signals.QLI),
    };
    const uplift = 1 + Math.max(0, Math.min(this.formula.maxUplift, input.upliftFactor));
    const estimate = eligible ? input.referencePrice * uplift
      * Math.pow(s.PRI, this.formula.beta) * Math.pow(s.BDI, this.formula.gamma)
      * Math.pow(s.SSI, this.formula.delta) * Math.pow(s.MRI, this.formula.epsilon) * s.QLI : 0;
    const result = {
      quoteId: randomUUID(), estimatedValue: Math.round(estimate * 10000) / 10000,
      currency: 'USD', eligible, denialReason: eligible ? null : 'consent_or_buyer_authorization_required',
      formulaVersion: this.formula.version, status: 'research_estimate' as const,
      breakdown: { referencePrice: input.referencePrice, uplift, ...s },
    };
    return result;
  }

  private recordResult(result: ReturnType<InversePricingEngine['quote']>) {
    this.completed += 1;
    if (!result.eligible) this.denied += 1;
    this.totalEstimate += result.estimatedValue;
    this.lastRunAt = new Date().toISOString();
  }

  currentFormula() { return { ...this.formula }; }

  simulate(formula: PricingFormula, inputs: ValuationInput[]) {
    const previous = this.formula;
    this.formula = formula;
    try {
      const values = inputs.map((input) => this.calculate(input).estimatedValue);
      const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return { averageEstimate: average, sampleSize: values.length, evidenceStatus: 'synthetic_or_hypothetical' as const };
    } finally {
      this.formula = previous;
    }
  }

  propose(formula: PricingFormula, actor: string, rationale: string) {
    const id = randomUUID();
    this.audit.push({ id, type: 'proposal', actor, createdAt: new Date().toISOString(), details: { formula, rationale } });
    return { proposalId: id, status: 'accepted_for_review' as const };
  }

  adminSnapshot() {
    return {
      status: 'research' as const,
      processingMode: 'background_aggregate' as const,
      completedQuotes: this.completed,
      authorizationDenied: this.denied,
      averageEstimatedValue: this.completed ? this.totalEstimate / this.completed : null,
      lastRunAt: this.lastRunAt,
      formula: this.currentFormula(),
      auditEntries: this.audit.slice(-25),
      claims: { marketPrice: false, guaranteedPayout: false, scientificValidation: false },
    };
  }
}

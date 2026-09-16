import { randomUUID } from 'node:crypto';

export type InverseSignals = { PRI: number; BDI: number; SSI: number; MRI: number; QLI: number };
export type InverseFormula = { beta: number; gamma: number; delta: number; epsilon: number; version: string };

const bounded = (value: number) => Math.max(0, Math.min(1, value));

export class InverseGrowthEngine {
  private behaviorEvents: Array<{ id: string; subjectId: string; type: string; occurredAt: string }> = [];
  private outcomes: Array<{ id: string; subjectId: string; engagementScore: number; occurredAt: string }> = [];
  private formula: InverseFormula = { beta: 1, gamma: 1, delta: 1, epsilon: 1, version: 'growth-rd-1.0.0' };
  private proposals: Array<{ id: string; formula: InverseFormula; rationale: string; createdAt: string }> = [];

  captureBehavior(subjectId: string, type: string, occurredAt: string) {
    const event = { id: randomUUID(), subjectId, type, occurredAt };
    this.behaviorEvents.push(event);
    return event;
  }

  generateSignals(input: InverseSignals) {
    return {
      PRI: bounded(input.PRI), BDI: bounded(input.BDI), SSI: bounded(input.SSI),
      MRI: bounded(input.MRI), QLI: bounded(input.QLI),
    };
  }

  captureOutcome(subjectId: string, engagementScore: number, occurredAt: string) {
    const outcome = { id: randomUUID(), subjectId, engagementScore: bounded(engagementScore), occurredAt };
    this.outcomes.push(outcome);
    return outcome;
  }

  currentFormula() { return { ...this.formula }; }

  simulate(hypothetical: Omit<InverseFormula, 'version'>, signals: InverseSignals[]) {
    const scores = signals.map((item) => {
      const s = this.generateSignals(item);
      return Math.pow(s.PRI, hypothetical.beta) * Math.pow(s.BDI, hypothetical.gamma)
        * Math.pow(s.SSI, hypothetical.delta) * Math.pow(s.MRI, hypothetical.epsilon) * s.QLI;
    });
    const projectedEngagementScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      projectedEngagementScore,
      projectedUplift: 0,
      riskScore: scores.length ? Math.max(...scores) - Math.min(...scores) : 0,
      evidenceStatus: 'simulation_only' as const,
    };
  }

  propose(formula: Omit<InverseFormula, 'version'>, rationale: string) {
    const proposal = {
      id: randomUUID(), formula: { ...formula, version: `growth-proposal-${this.proposals.length + 1}` },
      rationale, createdAt: new Date().toISOString(),
    };
    this.proposals.push(proposal);
    return proposal;
  }

  summary() {
    const average = this.outcomes.length
      ? this.outcomes.reduce((sum, item) => sum + item.engagementScore, 0) / this.outcomes.length : null;
    return {
      status: 'research' as const,
      behaviorEvents: this.behaviorEvents.length,
      outcomesCaptured: this.outcomes.length,
      averageObservedEngagement: average,
      formula: this.currentFormula(),
      pendingProposals: this.proposals.length,
      claims: { optimized: false, causalUpliftVerified: false },
    };
  }
}

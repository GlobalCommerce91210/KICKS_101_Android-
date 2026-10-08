import { randomUUID } from 'node:crypto';

export type ComplianceOutcome = 'allow' | 'allow_with_conditions' | 'deny';
export type CompliancePolicyStatus = 'active' | 'inactive';

export interface CompliancePolicy {
  policy_id: string;
  version: string;
  status: CompliancePolicyStatus;
  action: string;
  resource_type: string;
  required_consents: string[];
  required_attributes?: Record<string, string | number | boolean>;
  human_review: 'required' | 'not_required';
  conditions?: string[];
  effective_from: string;
  effective_to?: string | null;
}

export interface ComplianceEvaluationInput {
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  consents?: string[];
  attributes?: Record<string, string | number | boolean>;
  human_review?: {
    approved: boolean;
    reviewer_id?: string;
    reviewed_at?: string;
  };
}

export interface ComplianceDecision {
  decision_id: string;
  evaluated_at: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: ComplianceOutcome;
  policy_id: string | null;
  policy_version: string | null;
  reasons: string[];
  conditions: string[];
  human_review_required: boolean;
  human_review_approved: boolean;
}

export class ComplianceEngine {
  private policies = new Map<string, CompliancePolicy>();
  private decisions = new Map<string, ComplianceDecision>();

  public upsertPolicy(policy: CompliancePolicy): CompliancePolicy {
    const key = this.policyKey(policy.policy_id, policy.version);
    const stored = {
      ...policy,
      required_consents: [...policy.required_consents],
      required_attributes: policy.required_attributes
        ? { ...policy.required_attributes }
        : undefined,
      conditions: [...(policy.conditions ?? [])],
    };
    this.policies.set(key, stored);
    return this.clonePolicy(stored);
  }

  public getPolicy(policyId: string, version: string): CompliancePolicy | null {
    const policy = this.policies.get(this.policyKey(policyId, version));
    return policy ? this.clonePolicy(policy) : null;
  }

  public listPolicies(): CompliancePolicy[] {
    return [...this.policies.values()].map(policy => this.clonePolicy(policy));
  }

  public evaluate(input: ComplianceEvaluationInput): ComplianceDecision {
    const now = new Date();
    const matching = [...this.policies.values()].filter(policy =>
      policy.status === 'active'
      && policy.action === input.action
      && policy.resource_type === input.resource_type
      && this.isEffective(policy, now)
    );

    if (matching.length !== 1) {
      return this.recordDecision(input, {
        outcome: 'deny',
        policy: null,
        reasons: [matching.length === 0 ? 'no_active_policy' : 'ambiguous_active_policy'],
        conditions: [],
        humanReviewRequired: false,
        humanReviewApproved: false,
      });
    }

    const policy = matching[0]!;
    const grantedConsents = new Set(input.consents ?? []);
    const missingConsents = policy.required_consents.filter(
      consent => !grantedConsents.has(consent),
    );

    if (missingConsents.length > 0) {
      return this.recordDecision(input, {
        outcome: 'deny',
        policy,
        reasons: missingConsents.map(consent => `missing_required_consent:${consent}`),
        conditions: [],
        humanReviewRequired: policy.human_review === 'required',
        humanReviewApproved: input.human_review?.approved === true,
      });
    }

    const requiredAttributes = policy.required_attributes ?? {};
    const suppliedAttributes = input.attributes ?? {};
    const mismatchedAttributes = Object.entries(requiredAttributes)
      .filter(([key, expected]) => suppliedAttributes[key] !== expected)
      .map(([key]) => `required_attribute_mismatch:${key}`);

    if (mismatchedAttributes.length > 0) {
      return this.recordDecision(input, {
        outcome: 'deny',
        policy,
        reasons: mismatchedAttributes,
        conditions: [],
        humanReviewRequired: policy.human_review === 'required',
        humanReviewApproved: input.human_review?.approved === true,
      });
    }

    const humanReviewRequired = policy.human_review === 'required';
    const humanReviewApproved = input.human_review?.approved === true;
    const policyConditions = [...(policy.conditions ?? [])];

    if (humanReviewRequired && !humanReviewApproved) {
      return this.recordDecision(input, {
        outcome: 'allow_with_conditions',
        policy,
        reasons: ['human_review_required'],
        conditions: ['human_review_approval_required', ...policyConditions],
        humanReviewRequired,
        humanReviewApproved,
      });
    }

    if (policyConditions.length > 0) {
      return this.recordDecision(input, {
        outcome: 'allow_with_conditions',
        policy,
        reasons: ['policy_conditions_apply'],
        conditions: policyConditions,
        humanReviewRequired,
        humanReviewApproved,
      });
    }

    return this.recordDecision(input, {
      outcome: 'allow',
      policy,
      reasons: ['policy_requirements_satisfied'],
      conditions: [],
      humanReviewRequired,
      humanReviewApproved,
    });
  }

  public getDecision(decisionId: string): ComplianceDecision | null {
    const decision = this.decisions.get(decisionId);
    return decision ? this.cloneDecision(decision) : null;
  }

  public listDecisions(): ComplianceDecision[] {
    return [...this.decisions.values()].map(decision => this.cloneDecision(decision));
  }

  private recordDecision(
    input: ComplianceEvaluationInput,
    result: {
      outcome: ComplianceOutcome;
      policy: CompliancePolicy | null;
      reasons: string[];
      conditions: string[];
      humanReviewRequired: boolean;
      humanReviewApproved: boolean;
    },
  ): ComplianceDecision {
    const decision: ComplianceDecision = {
      decision_id: randomUUID(),
      evaluated_at: new Date().toISOString(),
      actor_id: input.actor_id,
      action: input.action,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      outcome: result.outcome,
      policy_id: result.policy?.policy_id ?? null,
      policy_version: result.policy?.version ?? null,
      reasons: [...result.reasons],
      conditions: [...result.conditions],
      human_review_required: result.humanReviewRequired,
      human_review_approved: result.humanReviewApproved,
    };
    this.decisions.set(decision.decision_id, decision);
    return this.cloneDecision(decision);
  }

  private isEffective(policy: CompliancePolicy, now: Date): boolean {
    const start = Date.parse(policy.effective_from);
    if (!Number.isFinite(start) || start > now.getTime()) return false;
    if (!policy.effective_to) return true;
    const end = Date.parse(policy.effective_to);
    return Number.isFinite(end) && end >= now.getTime();
  }

  private policyKey(policyId: string, version: string): string {
    return `${policyId}:${version}`;
  }

  private clonePolicy(policy: CompliancePolicy): CompliancePolicy {
    return {
      ...policy,
      required_consents: [...policy.required_consents],
      required_attributes: policy.required_attributes
        ? { ...policy.required_attributes }
        : undefined,
      conditions: [...(policy.conditions ?? [])],
    };
  }

  private cloneDecision(decision: ComplianceDecision): ComplianceDecision {
    return {
      ...decision,
      reasons: [...decision.reasons],
      conditions: [...decision.conditions],
    };
  }
}

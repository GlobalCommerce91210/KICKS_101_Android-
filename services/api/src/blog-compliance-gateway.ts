import { randomUUID } from 'node:crypto';
import {
  ComplianceEngine,
  type ComplianceDecision,
} from './compliance.js';

export interface BlogSubmissionInput {
  actor_id: string;
  resource_id: string;
  content_hash: string;
  consents?: string[];
  attributes?: Record<string, string | number | boolean>;
}

export interface BlogSubmission {
  submission_id: string;
  actor_id: string;
  resource_id: string;
  content_hash: string;
  consents: string[];
  attributes: Record<string, string | number | boolean>;
  submitted_at: string;
}

export interface BlogHumanReview {
  review_id: string;
  submission_id: string;
  reviewer_id: string;
  approved: boolean;
  reviewed_at: string;
}

export interface BlogPublishAuthorization {
  authorization_id: string;
  submission_id: string;
  resource_id: string;
  actor_id: string;
  decision_id: string;
  outcome: ComplianceDecision['outcome'];
  permitted: boolean;
  conditions: string[];
  denial_reason: string | null;
  issued_at: string;
}

export class BlogComplianceGateway {
  private submissions = new Map<string, BlogSubmission>();
  private reviews = new Map<string, BlogHumanReview>();
  private authorizations = new Map<string, BlogPublishAuthorization>();

  public constructor(private complianceEngine: ComplianceEngine) {}

  public createSubmission(input: BlogSubmissionInput): BlogSubmission {
    const submission: BlogSubmission = {
      submission_id: randomUUID(),
      actor_id: input.actor_id,
      resource_id: input.resource_id,
      content_hash: input.content_hash,
      consents: [...(input.consents ?? [])],
      attributes: { ...(input.attributes ?? {}) },
      submitted_at: new Date().toISOString(),
    };

    this.submissions.set(submission.submission_id, submission);
    return this.cloneSubmission(submission);
  }

  public getSubmission(submissionId: string): BlogSubmission | null {
    const submission = this.submissions.get(submissionId);
    return submission ? this.cloneSubmission(submission) : null;
  }

  public recordHumanReview(
    submissionId: string,
    reviewerId: string,
    approved: boolean,
  ): BlogHumanReview {
    if (!this.submissions.has(submissionId)) {
      throw new Error('submission_not_found');
    }

    const review: BlogHumanReview = {
      review_id: randomUUID(),
      submission_id: submissionId,
      reviewer_id: reviewerId,
      approved,
      reviewed_at: new Date().toISOString(),
    };

    this.reviews.set(submissionId, review);
    return { ...review };
  }

  public getHumanReview(submissionId: string): BlogHumanReview | null {
    const review = this.reviews.get(submissionId);
    return review ? { ...review } : null;
  }

  public authorizePublish(submissionId: string): BlogPublishAuthorization {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new Error('submission_not_found');
    }

    const review = this.reviews.get(submissionId);

    const decision = this.complianceEngine.evaluate({
      actor_id: submission.actor_id,
      action: 'blog.publish',
      resource_type: 'blog_post',
      resource_id: submission.resource_id,
      consents: submission.consents,
      attributes: submission.attributes,
      human_review: review
        ? {
            approved: review.approved,
            reviewer_id: review.reviewer_id,
            reviewed_at: review.reviewed_at,
          }
        : undefined,
    });

    const permitted =
      decision.outcome === 'allow'
      || (
        decision.outcome === 'allow_with_conditions'
        && decision.human_review_required
        && decision.human_review_approved
      );

    const denialReason = permitted
      ? null
      : decision.reasons[0] ?? 'compliance_authorization_denied';

    const authorization: BlogPublishAuthorization = {
      authorization_id: randomUUID(),
      submission_id: submission.submission_id,
      resource_id: submission.resource_id,
      actor_id: submission.actor_id,
      decision_id: decision.decision_id,
      outcome: decision.outcome,
      permitted,
      conditions: [...decision.conditions],
      denial_reason: denialReason,
      issued_at: new Date().toISOString(),
    };

    this.authorizations.set(authorization.authorization_id, authorization);
    return this.cloneAuthorization(authorization);
  }

  public getAuthorization(
    authorizationId: string,
  ): BlogPublishAuthorization | null {
    const authorization = this.authorizations.get(authorizationId);
    return authorization ? this.cloneAuthorization(authorization) : null;
  }

  private cloneSubmission(submission: BlogSubmission): BlogSubmission {
    return {
      ...submission,
      consents: [...submission.consents],
      attributes: { ...submission.attributes },
    };
  }

  private cloneAuthorization(
    authorization: BlogPublishAuthorization,
  ): BlogPublishAuthorization {
    return {
      ...authorization,
      conditions: [...authorization.conditions],
    };
  }
}

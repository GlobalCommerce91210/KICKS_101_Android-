import { randomUUID } from 'node:crypto';
import { IntelligenceEngine } from './intelligence.js';
import { PermissionsEngine } from './permissions.js';

export interface WalletAccount {
  wallet_id: string;
  user_id: string;
  pending_balance: number;
  approved_balance: number;
  settled_balance: number;
  bonus_balance: number;
  created_at: string;
  updated_at: string;
}

export interface WalletLedgerEntry {
  ledger_id: string;
  wallet_id: string;
  event_id: string;
  app_id: string;
  metadata_types: string[];
  buyer_category: string;
  offer_id: string;
  value: number;
  multiplier: number;
  bonus: number;
  consent_state: 'allowed' | 'blocked' | 'conditional';
  permission_state: 'permitted' | 'denied';
  denial_reason: string | null;
  status: 'pending' | 'approved' | 'settled' | 'rejected';
  timestamp: string;
}

export interface WalletSummary {
  total_earned: number;
  total_pending: number;
  total_settled: number;
  earnings_by_app: Record<string, number>;
  earnings_by_metadata: Record<string, number>;
  earnings_by_buyer: Record<string, number>;
  earnings_by_persona: Record<string, number>;
  earnings_by_period: Record<string, number>;
}

export interface PayoutRequest {
  payout_id: string;
  wallet_id: string;
  amount: number;
  method: string;
  status: 'requested' | 'processing' | 'completed' | 'failed';
  timestamp: string;
}

export interface ProgressionState {
  level: number;
  xp: number;
  next_level_xp: number;
  percentile_rank: number;
  milestones_unlocked: string[];
  bonuses: {
    persona_multiplier: number;
    streak_bonus: number;
    trust_bonus: number;
  };
}

export class WalletEngine {
  private wallets = new Map<string, WalletAccount>();
  private ledgers = new Map<string, WalletLedgerEntry[]>();
  private progressions = new Map<string, ProgressionState>();
  private payouts = new Map<string, PayoutRequest[]>();

  constructor(
    private intelligenceEngine: IntelligenceEngine,
    private permissionsEngine?: PermissionsEngine,
  ) {}

  public setPermissionsEngine(permissionsEngine: PermissionsEngine) {
    this.permissionsEngine = permissionsEngine;
  }

  public getOrCreateWallet(userId: string): WalletAccount {
    const normalized = userId.trim();
    if (!normalized) throw new Error('user_id_required');
    const existing = this.wallets.get(normalized);
    if (existing) return existing;

    const now = new Date().toISOString();
    const wallet: WalletAccount = {
      wallet_id: `wal-${randomUUID()}`,
      user_id: normalized,
      pending_balance: 0,
      approved_balance: 0,
      settled_balance: 0,
      bonus_balance: 0,
      created_at: now,
      updated_at: now,
    };
    this.wallets.set(normalized, wallet);
    this.ledgers.set(normalized, []);
    this.progressions.set(normalized, {
      level: 1,
      xp: 0,
      next_level_xp: 500,
      percentile_rank: 0,
      milestones_unlocked: [],
      bonuses: {
        persona_multiplier: 1,
        streak_bonus: 0,
        trust_bonus: 0,
      },
    });
    return wallet;
  }

  private isEntryPermitted(userId: string, entry: WalletLedgerEntry): { permitted: boolean; reason: string | null } {
    if (!this.permissionsEngine) return { permitted: false, reason: 'Permission engine is unavailable' };

    const appPermission = this.permissionsEngine.getAppPermissions(userId).find(item => item.app_id === entry.app_id);
    if (!appPermission || appPermission.state !== 'allowed') {
      return { permitted: false, reason: `Explicit app permission is required for ${entry.app_id}` };
    }

    const buyerPermission = this.permissionsEngine.getBuyerPermissions(userId).find(item => item.buyer_category === entry.buyer_category);
    if (!buyerPermission || buyerPermission.state !== 'allowed') {
      return { permitted: false, reason: `Explicit buyer permission is required for '${entry.buyer_category}'` };
    }

    const metadataPermissions = this.permissionsEngine.getMetadataPermissions(userId, entry.app_id);
    for (const metadataType of entry.metadata_types) {
      const permission = metadataPermissions.find(item => item.metadata_type === metadataType);
      if (!permission) return { permitted: false, reason: `Metadata permission '${metadataType}' is missing` };
      if (permission.state === 'blocked') return { permitted: false, reason: `Metadata type '${metadataType}' is blocked` };
      if (permission.state === 'conditional') {
        const override = permission.buyer_overrides?.find(item => item.buyer_category === entry.buyer_category);
        if (!override || override.state !== 'allowed') {
          return { permitted: false, reason: `Metadata type '${metadataType}' requires an explicit buyer-specific grant` };
        }
      }
    }

    if (entry.consent_state !== 'allowed') return { permitted: false, reason: 'Commercial consent is not explicitly allowed' };
    return { permitted: true, reason: null };
  }

  public getProgression(userId: string): ProgressionState {
    this.getOrCreateWallet(userId);
    return this.progressions.get(userId)!;
  }

  public getLedger(userId: string, page = 1, pageSize = 50): { items: WalletLedgerEntry[]; page: number; page_size: number } {
    this.getOrCreateWallet(userId);
    const annotated = (this.ledgers.get(userId) ?? []).map(entry => {
      const check = this.isEntryPermitted(userId, entry);
      return {
        ...entry,
        permission_state: check.permitted ? ('permitted' as const) : ('denied' as const),
        denial_reason: check.permitted ? null : check.reason,
        status: check.permitted ? entry.status : ('rejected' as const),
      };
    });
    const start = (page - 1) * pageSize;
    return { items: annotated.slice(start, start + pageSize), page, page_size: pageSize };
  }

  public getSummary(userId: string): WalletSummary {
    this.getOrCreateWallet(userId);
    const permitted = (this.ledgers.get(userId) ?? []).filter(entry => this.isEntryPermitted(userId, entry).permitted && entry.status !== 'rejected');
    const earnings_by_app: Record<string, number> = {};
    const earnings_by_metadata: Record<string, number> = {};
    const earnings_by_buyer: Record<string, number> = {};
    const earnings_by_persona: Record<string, number> = {};
    const earnings_by_period = { today: 0, this_week: 0, this_month: 0 };
    let totalApproved = 0;
    let totalPending = 0;
    let totalSettled = 0;

    const now = Date.now();
    for (const entry of permitted) {
      const amount = Number((entry.value + entry.bonus).toFixed(2));
      if (entry.status === 'pending') totalPending += amount;
      if (entry.status === 'approved') totalApproved += amount;
      if (entry.status === 'settled') totalSettled += amount;
      earnings_by_app[entry.app_id] = Number(((earnings_by_app[entry.app_id] ?? 0) + amount).toFixed(2));
      earnings_by_buyer[entry.buyer_category] = Number(((earnings_by_buyer[entry.buyer_category] ?? 0) + amount).toFixed(2));
      for (const metadataType of entry.metadata_types) {
        earnings_by_metadata[metadataType] = Number(((earnings_by_metadata[metadataType] ?? 0) + amount / Math.max(1, entry.metadata_types.length)).toFixed(2));
      }
      const age = now - new Date(entry.timestamp).getTime();
      if (age <= 24 * 60 * 60 * 1000) earnings_by_period.today += amount;
      if (age <= 7 * 24 * 60 * 60 * 1000) earnings_by_period.this_week += amount;
      if (age <= 30 * 24 * 60 * 60 * 1000) earnings_by_period.this_month += amount;
    }

    const wallet = this.wallets.get(userId)!;
    wallet.pending_balance = Number(totalPending.toFixed(2));
    wallet.approved_balance = Number(totalApproved.toFixed(2));
    wallet.settled_balance = Number(totalSettled.toFixed(2));
    wallet.updated_at = new Date().toISOString();

    return {
      total_earned: Number((totalApproved + totalSettled).toFixed(2)),
      total_pending: wallet.pending_balance,
      total_settled: wallet.settled_balance,
      earnings_by_app,
      earnings_by_metadata,
      earnings_by_buyer,
      earnings_by_persona,
      earnings_by_period: Object.fromEntries(Object.entries(earnings_by_period).map(([key, value]) => [key, Number(value.toFixed(2))])),
    };
  }

  public getEarningsByApp(userId: string): Record<string, number> {
    return this.getSummary(userId).earnings_by_app;
  }

  public getEarningsByMetadata(userId: string): Record<string, number> {
    return this.getSummary(userId).earnings_by_metadata;
  }

  public recordEventEarnings(eventId: string, targetUserId: string): {
    permitted: boolean;
    denial_reason: string | null;
    ledger_entry: WalletLedgerEntry;
    wallet: WalletAccount;
    progression_update: ProgressionState;
  } {
    const userId = targetUserId.trim();
    if (!userId) throw new Error('user_id_required');
    const eventView = this.intelligenceEngine.getEvent(eventId);
    if (!eventView) throw new Error('event_not_found');

    const marketplace = this.intelligenceEngine.matchMarketplace({ app_id: eventView.app_id });
    const verifiedMatch = marketplace.matched_offers.find(item => item.events_matched > 0 && item.total_payout > 0);
    if (!verifiedMatch) throw new Error('verified_marketplace_match_required');

    const wallet = this.getOrCreateWallet(userId);
    const metadataTypes = [...new Set(eventView.metadata_inspection.metadata_items.map(item => item.type))];
    const candidate: WalletLedgerEntry = {
      ledger_id: `led-${randomUUID()}`,
      wallet_id: wallet.wallet_id,
      event_id: eventId,
      app_id: eventView.app_id,
      metadata_types: metadataTypes,
      buyer_category: verifiedMatch.offer.buyer_category,
      offer_id: verifiedMatch.offer.offer_id,
      value: Number(verifiedMatch.total_payout.toFixed(2)),
      multiplier: 1,
      bonus: 0,
      consent_state: 'allowed',
      permission_state: 'denied',
      denial_reason: null,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };

    const permission = this.isEntryPermitted(userId, candidate);
    candidate.permission_state = permission.permitted ? 'permitted' : 'denied';
    candidate.denial_reason = permission.reason;
    candidate.status = permission.permitted ? 'pending' : 'rejected';

    const ledger = this.ledgers.get(userId) ?? [];
    ledger.unshift(candidate);
    this.ledgers.set(userId, ledger);
    this.getSummary(userId);

    return {
      permitted: permission.permitted,
      denial_reason: permission.reason,
      ledger_entry: candidate,
      wallet,
      progression_update: this.getProgression(userId),
    };
  }

  public requestPayout(userId: string, amount: number, method: string): {
    permitted: boolean;
    denial_reason: string | null;
    payout?: PayoutRequest;
    wallet: WalletAccount;
  } {
    const wallet = this.getOrCreateWallet(userId);
    this.getSummary(userId);
    if (!Number.isFinite(amount) || amount <= 0) return { permitted: false, denial_reason: 'A positive payout amount is required', wallet };
    if (amount > wallet.approved_balance) return { permitted: false, denial_reason: 'Requested amount exceeds the verified approved balance', wallet };
    if (!method.trim()) return { permitted: false, denial_reason: 'A payout method is required', wallet };

    const payout: PayoutRequest = {
      payout_id: `pay-${randomUUID()}`,
      wallet_id: wallet.wallet_id,
      amount: Number(amount.toFixed(2)),
      method: method.trim(),
      status: 'requested',
      timestamp: new Date().toISOString(),
    };
    const payouts = this.payouts.get(userId) ?? [];
    payouts.unshift(payout);
    this.payouts.set(userId, payouts);
    return { permitted: true, denial_reason: null, payout, wallet };
  }
}

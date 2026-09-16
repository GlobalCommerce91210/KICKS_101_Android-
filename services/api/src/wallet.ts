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
  private intelligenceEngine: IntelligenceEngine;
  private permissionsEngine?: PermissionsEngine;

  constructor(intelligenceEngine: IntelligenceEngine, permissionsEngine?: PermissionsEngine) {
    this.intelligenceEngine = intelligenceEngine;
    this.permissionsEngine = permissionsEngine;
    this.seedDefaultUser('user_demo_01');
  }

  public setPermissionsEngine(permissionsEngine: PermissionsEngine) {
    this.permissionsEngine = permissionsEngine;
  }

  private seedDefaultUser(userId: string) {
    const walletId = `wal-${userId}`;
    const now = new Date();
    const createdAt = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 14).toISOString();

    const wallet: WalletAccount = {
      wallet_id: walletId,
      user_id: userId,
      pending_balance: 4.20,
      approved_balance: 24.80,
      settled_balance: 12.50,
      bonus_balance: 3.10,
      created_at: createdAt,
      updated_at: now.toISOString()
    };
    this.wallets.set(userId, wallet);

    const entries: WalletLedgerEntry[] = [
      {
        ledger_id: `led-${randomUUID().slice(0, 8)}`,
        wallet_id: walletId,
        event_id: 'evt-shop-sample-01',
        app_id: 'com.example.shop',
        metadata_types: ['commercial', 'intent', 'transactional'],
        buyer_category: 'Consumer Insights & Market Research',
        offer_id: 'offer-retail-001',
        value: 8.00,
        multiplier: 1.25,
        bonus: 1.00,
        consent_state: 'allowed',
        permission_state: 'permitted',
        denial_reason: null,
        status: 'approved',
        timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString()
      },
      {
        ledger_id: `led-${randomUUID().slice(0, 8)}`,
        wallet_id: walletId,
        event_id: 'evt-transit-map-02',
        app_id: 'com.example.transit',
        metadata_types: ['behavioral', 'device'],
        buyer_category: 'Urban Mobility Demand Research',
        offer_id: 'offer-mobility-002',
        value: 0.80,
        multiplier: 1.10,
        bonus: 0.10,
        consent_state: 'allowed',
        permission_state: 'permitted',
        denial_reason: null,
        status: 'settled',
        timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 18).toISOString()
      },
      {
        ledger_id: `led-${randomUUID().slice(0, 8)}`,
        wallet_id: walletId,
        event_id: 'evt-retail-03',
        app_id: 'com.retail.trends',
        metadata_types: ['commercial', 'intent'],
        buyer_category: 'Consumer Insights & Market Research',
        offer_id: 'offer-retail-001',
        value: 4.20,
        multiplier: 1.30,
        bonus: 0.50,
        consent_state: 'conditional',
        permission_state: 'permitted',
        denial_reason: null,
        status: 'pending',
        timestamp: new Date(now.getTime() - 1000 * 60 * 45).toISOString()
      },
      {
        ledger_id: `led-${randomUUID().slice(0, 8)}`,
        wallet_id: walletId,
        event_id: 'evt-diag-04',
        app_id: 'com.example.shop',
        metadata_types: ['operational', 'device'],
        buyer_category: 'Open Telemetry Performance Lab',
        offer_id: 'offer-telemetry-003',
        value: 0.40,
        multiplier: 1.00,
        bonus: 0.00,
        consent_state: 'allowed',
        permission_state: 'permitted',
        denial_reason: null,
        status: 'settled',
        timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 48).toISOString()
      }
    ];
    this.ledgers.set(userId, entries);

    const progression: ProgressionState = {
      level: 4,
      xp: 1450,
      next_level_xp: 2000,
      percentile_rank: 94,
      milestones_unlocked: [
        'FIRST_SIGNAL_COMPENSATED',
        'METADATA_MINIMIZATION_CHAMPION',
        'STREAK_7_DAYS',
        'RESEARCH_PARTNER_VERIFIED'
      ],
      bonuses: {
        persona_multiplier: 1.35,
        streak_bonus: 0.15,
        trust_bonus: 0.10
      }
    };
    this.progressions.set(userId, progression);
  }

  public getOrCreateWallet(userId: string): WalletAccount {
    let wallet = this.wallets.get(userId);
    if (!wallet) {
      const walletId = `wal-${userId}`;
      const now = new Date().toISOString();
      wallet = {
        wallet_id: walletId,
        user_id: userId,
        pending_balance: 0,
        approved_balance: 0,
        settled_balance: 0,
        bonus_balance: 0,
        created_at: now,
        updated_at: now
      };
      this.wallets.set(userId, wallet);
      this.ledgers.set(userId, []);
      this.progressions.set(userId, {
        level: 1,
        xp: 0,
        next_level_xp: 500,
        percentile_rank: 50,
        milestones_unlocked: ['ACCOUNT_INITIALIZED'],
        bonuses: {
          persona_multiplier: 1.0,
          streak_bonus: 0.0,
          trust_bonus: 0.05
        }
      });
    }
    return wallet;
  }

  private isEntryPermitted(userId: string, entry: WalletLedgerEntry): { permitted: boolean; reason: string | null } {
    if (!this.permissionsEngine) {
      return { permitted: true, reason: null };
    }

    // 1. App-level check
    const apps = this.permissionsEngine.getAppPermissions(userId);
    const appPerm = apps.find(a => a.app_id === entry.app_id);
    if (appPerm && appPerm.state === 'blocked') {
      return { permitted: false, reason: `App ${entry.app_id} is blocked by user permission policy` };
    }

    // 2. Buyer category check
    const buyers = this.permissionsEngine.getBuyerPermissions(userId);
    const buyerPerm = buyers.find(b => b.buyer_category === entry.buyer_category);
    if (buyerPerm && buyerPerm.state === 'blocked') {
      return { permitted: false, reason: `Buyer category '${entry.buyer_category}' is blocked` };
    }

    // 3. Metadata permissions check for this app
    const metaPerms = this.permissionsEngine.getMetadataPermissions(userId, entry.app_id);
    for (const mtype of entry.metadata_types) {
      const perm = metaPerms.find(p => p.metadata_type === mtype);
      if (perm) {
        if (perm.state === 'blocked') {
          return { permitted: false, reason: `Metadata type '${mtype}' is blocked for ${entry.app_id}` };
        }
        if (perm.state === 'conditional') {
          const override = perm.buyer_overrides?.find(o => o.buyer_category === entry.buyer_category);
          if (override && override.state === 'blocked') {
            return { permitted: false, reason: `Metadata type '${mtype}' is blocked for buyer '${entry.buyer_category}'` };
          }
        }
      }
    }

    // 4. Consent state check
    if (entry.consent_state === 'blocked') {
      return { permitted: false, reason: 'Consent state is blocked' };
    }

    return { permitted: true, reason: null };
  }

  public getProgression(userId: string): ProgressionState {
    this.getOrCreateWallet(userId);
    const progression = this.progressions.get(userId)!;
    // XP and bonuses are only applied for permitted earnings
    // Recalculate XP from permitted entries if needed
    const all = this.ledgers.get(userId) ?? [];
    const permittedEntries = all.filter(e => {
      const check = this.isEntryPermitted(userId, e);
      return check.permitted;
    });

    const baseLevel = 1;
    let earnedXp = permittedEntries.length * 85;
    let level = baseLevel;
    let nextXp = 500;
    while (earnedXp >= nextXp) {
      level += 1;
      earnedXp -= nextXp;
      nextXp = Math.round(nextXp * 1.4);
    }

    return {
      ...progression,
      level: Math.max(progression.level, level),
      xp: Math.max(progression.xp, earnedXp),
      next_level_xp: nextXp
    };
  }

  public getLedger(userId: string, page = 1, pageSize = 50): { items: WalletLedgerEntry[]; page: number; page_size: number } {
    this.getOrCreateWallet(userId);
    const all = this.ledgers.get(userId) ?? [];

    // Dynamically update permission_state and denial_reason based on current permission policy
    const annotated = all.map(entry => {
      const check = this.isEntryPermitted(userId, entry);
      return {
        ...entry,
        permission_state: check.permitted ? ('permitted' as const) : ('denied' as const),
        denial_reason: check.permitted ? null : check.reason,
        status: check.permitted ? entry.status : ('rejected' as const)
      };
    });

    const start = (page - 1) * pageSize;
    const items = annotated.slice(start, start + pageSize);
    return {
      items,
      page,
      page_size: pageSize
    };
  }

  public getSummary(userId: string): WalletSummary {
    const wallet = this.getOrCreateWallet(userId);
    const rawLedger = this.ledgers.get(userId) ?? [];

    // Filter out items that are blocked by current permissions
    const permittedLedger: WalletLedgerEntry[] = [];
    for (const item of rawLedger) {
      const check = this.isEntryPermitted(userId, item);
      if (check.permitted && item.status !== 'rejected') {
        permittedLedger.push(item);
      }
    }

    let calculatedApproved = 0;
    let calculatedSettled = 0;
    let calculatedPending = 0;

    const earnings_by_app: Record<string, number> = {};
    const earnings_by_metadata: Record<string, number> = {};
    const earnings_by_buyer: Record<string, number> = {};
    const earnings_by_persona: Record<string, number> = {
      heavy_commercial: 0,
      light_commercial: 0,
      operational: 0,
      mixed: 0
    };
    const earnings_by_period: Record<string, number> = {
      today: 0,
      this_week: 0,
      this_month: 0
    };

    for (const item of permittedLedger) {
      const totalItem = Number((item.value + item.bonus).toFixed(2));
      if (item.status === 'pending') {
        calculatedPending += totalItem;
      } else if (item.status === 'settled') {
        calculatedSettled += totalItem;
      } else if (item.status === 'approved') {
        calculatedApproved += totalItem;
      }

      earnings_by_app[item.app_id] = Number(((earnings_by_app[item.app_id] ?? 0) + totalItem).toFixed(2));
      earnings_by_buyer[item.buyer_category] = Number(((earnings_by_buyer[item.buyer_category] ?? 0) + totalItem).toFixed(2));

      for (const mtype of item.metadata_types) {
        earnings_by_metadata[mtype] = Number(((earnings_by_metadata[mtype] ?? 0) + (totalItem / item.metadata_types.length)).toFixed(2));
      }

      if (item.app_id.includes('shop') || item.app_id.includes('retail')) {
        earnings_by_persona.heavy_commercial = Number(((earnings_by_persona.heavy_commercial ?? 0) + totalItem).toFixed(2));
      } else {
        earnings_by_persona.operational = Number(((earnings_by_persona.operational ?? 0) + totalItem).toFixed(2));
      }

      earnings_by_period.this_week = Number(((earnings_by_period.this_week ?? 0) + totalItem).toFixed(2));
    }

    const total_earned = Number((calculatedApproved + calculatedSettled).toFixed(2));
    const total_pending = Number(calculatedPending.toFixed(2));
    const total_settled = Number(calculatedSettled.toFixed(2));
    earnings_by_period.this_month = total_earned;
    earnings_by_period.today = Number(((earnings_by_period.this_week ?? 0) * 0.4).toFixed(2));

    return {
      total_earned,
      total_pending,
      total_settled,
      earnings_by_app,
      earnings_by_metadata,
      earnings_by_buyer,
      earnings_by_persona,
      earnings_by_period
    };
  }

  public getEarningsByApp(userId: string): Record<string, number> {
    return this.getSummary(userId).earnings_by_app;
  }

  public getEarningsByMetadata(userId: string): Record<string, number> {
    return this.getSummary(userId).earnings_by_metadata;
  }

  public recordEventEarnings(eventId: string, targetUserId = 'user_demo_01'): {
    permitted: boolean;
    denial_reason: string | null;
    ledger_entry: WalletLedgerEntry;
    wallet: WalletAccount;
    progression_update: ProgressionState;
  } {
    const wallet = this.getOrCreateWallet(targetUserId);
    const progression = this.getProgression(targetUserId);

    const eventView = this.intelligenceEngine.getEvent(eventId);
    const appId = eventView?.app_id ?? 'com.example.shop';
    const isCommercial = eventView?.classification.category === 'behavioral_commercial' || appId.includes('shop');

    const metaTypes = eventView?.metadata_inspection.metadata_items.map(m => m.type) ?? ['commercial', 'intent'];
    const baseValue = eventView?.scores.metadata_value_estimate && eventView.scores.metadata_value_estimate > 0
      ? eventView.scores.metadata_value_estimate * 10
      : (isCommercial ? 2.50 : 0.60);

    const multiplier = progression.bonuses.persona_multiplier;
    const bonus = Number((baseValue * (progression.bonuses.streak_bonus + progression.bonuses.trust_bonus)).toFixed(2));

    const candidateBuyer = isCommercial ? 'Consumer Insights & Market Research' : 'Open Telemetry Performance Lab';
    const candidateConsent = 'allowed';

    const candidateEntry: WalletLedgerEntry = {
      ledger_id: `led-${randomUUID().slice(0, 8)}`,
      wallet_id: wallet.wallet_id,
      event_id: eventId,
      app_id: appId,
      metadata_types: metaTypes,
      buyer_category: candidateBuyer,
      offer_id: isCommercial ? 'offer-retail-001' : 'offer-telemetry-003',
      value: baseValue,
      multiplier,
      bonus,
      consent_state: candidateConsent,
      permission_state: 'permitted',
      denial_reason: null,
      status: 'approved',
      timestamp: new Date().toISOString()
    };

    // Evaluate permissions
    const permCheck = this.isEntryPermitted(targetUserId, candidateEntry);

    if (!permCheck.permitted) {
      candidateEntry.permission_state = 'denied';
      candidateEntry.denial_reason = permCheck.reason;
      candidateEntry.status = 'rejected';

      const ledgerList = this.ledgers.get(targetUserId) ?? [];
      ledgerList.unshift(candidateEntry);
      this.ledgers.set(targetUserId, ledgerList);

      return {
        permitted: false,
        denial_reason: permCheck.reason,
        ledger_entry: candidateEntry,
        wallet,
        progression_update: progression
      };
    }

    // Permitted: commit earnings and progression
    const ledgerList = this.ledgers.get(targetUserId) ?? [];
    ledgerList.unshift(candidateEntry);
    this.ledgers.set(targetUserId, ledgerList);

    wallet.approved_balance = Number((wallet.approved_balance + (baseValue * multiplier)).toFixed(2));
    wallet.bonus_balance = Number((wallet.bonus_balance + bonus).toFixed(2));
    wallet.updated_at = new Date().toISOString();

    // Progression XP
    progression.xp += 85;
    if (progression.xp >= progression.next_level_xp) {
      progression.level += 1;
      progression.xp = progression.xp - progression.next_level_xp;
      progression.next_level_xp = Math.round(progression.next_level_xp * 1.4);
      progression.percentile_rank = Math.min(99, progression.percentile_rank + 1);
      progression.milestones_unlocked.push(`LEVEL_${progression.level}_REACHED`);
    }

    return {
      permitted: true,
      denial_reason: null,
      ledger_entry: candidateEntry,
      wallet,
      progression_update: progression
    };
  }

  public requestPayout(userId: string, amount: number, method: string): {
    permitted: boolean;
    denial_reason: string | null;
    payout?: PayoutRequest;
    wallet: WalletAccount;
  } {
    const wallet = this.getOrCreateWallet(userId);

    // Permission enforcement checks for payout:
    if (this.permissionsEngine) {
      const ledger = this.ledgers.get(userId) ?? [];
      const approvedEntries = ledger.filter(e => e.status === 'approved' || e.status === 'settled');

      // 1. Check if any approved earning in history came from a currently blocked app
      const apps = this.permissionsEngine.getAppPermissions(userId);
      const blockedApps = new Set(apps.filter(a => a.state === 'blocked').map(a => a.app_id));
      for (const entry of approvedEntries) {
        if (blockedApps.has(entry.app_id)) {
          return {
            permitted: false,
            denial_reason: `Payout denied: earning source ${entry.app_id} is blocked by user policy`,
            wallet
          };
        }
      }

      // 2. Check if any approved earning in history was purchased by a currently blocked buyer
      const buyers = this.permissionsEngine.getBuyerPermissions(userId);
      const blockedBuyers = new Set(buyers.filter(b => b.state === 'blocked').map(b => b.buyer_category));
      for (const entry of approvedEntries) {
        if (blockedBuyers.has(entry.buyer_category)) {
          return {
            permitted: false,
            denial_reason: `Payout denied: earning buyer category '${entry.buyer_category}' is currently blocked`,
            wallet
          };
        }
      }

      // 3. Check if any metadata type in approved earnings is currently blocked
      for (const entry of approvedEntries) {
        const metaPerms = this.permissionsEngine.getMetadataPermissions(userId, entry.app_id);
        for (const mtype of entry.metadata_types) {
          const mPerm = metaPerms.find(p => p.metadata_type === mtype);
          if (mPerm && mPerm.state === 'blocked') {
            return {
              permitted: false,
              denial_reason: `Payout denied: metadata type '${mtype}' for app ${entry.app_id} is blocked`,
              wallet
            };
          }
        }
      }
    }

    const payoutAmount = Math.min(amount, wallet.approved_balance);
    wallet.approved_balance = Number((wallet.approved_balance - payoutAmount).toFixed(2));
    wallet.settled_balance = Number((wallet.settled_balance + payoutAmount).toFixed(2));
    wallet.updated_at = new Date().toISOString();

    const payout: PayoutRequest = {
      payout_id: `pay-${randomUUID().slice(0, 8)}`,
      wallet_id: wallet.wallet_id,
      amount: payoutAmount,
      method,
      status: 'completed',
      timestamp: new Date().toISOString()
    };

    const payoutList = this.payouts.get(userId) ?? [];
    payoutList.unshift(payout);
    this.payouts.set(userId, payoutList);

    return {
      permitted: true,
      denial_reason: null,
      payout,
      wallet
    };
  }
}

import { Platform } from 'react-native';

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

function getBaseUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export const walletApi = {
  async getWalletSummary(userId: string): Promise<WalletSummary> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/${encodeURIComponent(userId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get wallet summary`);
    return res.json();
  },

  async getWalletLedger(userId: string, page = 1, pageSize = 50): Promise<{ items: WalletLedgerEntry[]; page: number; page_size: number }> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/${encodeURIComponent(userId)}/ledger?page=${page}&page_size=${pageSize}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get ledger`);
    return res.json();
  },

  async getProgression(userId: string): Promise<ProgressionState> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/${encodeURIComponent(userId)}/progress`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get progression`);
    return res.json();
  },

  async getEarningsByApp(userId: string): Promise<Record<string, number>> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/${encodeURIComponent(userId)}/apps`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get earnings by app`);
    const data = await res.json();
    return data.earnings_by_app ?? {};
  },

  async getEarningsByMetadata(userId: string): Promise<Record<string, number>> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/${encodeURIComponent(userId)}/metadata`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to get earnings by metadata`);
    const data = await res.json();
    return data.earnings_by_metadata ?? {};
  },

  async recordEventEarnings(eventId?: string, userId = 'user_demo_01'): Promise<{
    permitted: boolean;
    denial_reason: string | null;
    ledger_entry: WalletLedgerEntry;
    wallet: WalletAccount;
    progression_update: ProgressionState;
  }> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/events/earn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, user_id: userId })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to record event earnings`);
    return res.json();
  },

  async requestPayout(
    userId: string,
    amount: number,
    method: 'bank_transfer' | 'usdc_solana' | 'usdc_base' | 'gift_card' | 'partner_credit'
  ): Promise<{
    permitted: boolean;
    denial_reason: string | null;
    payout?: PayoutRequest;
    wallet: WalletAccount;
  }> {
    const res = await fetch(`${getBaseUrl()}/v1/wallet/${encodeURIComponent(userId)}/payout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount, method })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: failed to request payout`);
    return res.json();
  }
};

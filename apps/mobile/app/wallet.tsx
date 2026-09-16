import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import {
  PayoutRequest,
  ProgressionState,
  walletApi,
  WalletLedgerEntry,
  WalletSummary
} from '../services/walletApi';

const USER_ID = 'user_demo_01';

type Tab = 'ledger' | 'by_app' | 'by_metadata';

export default function Wallet() {
  const [activeTab, setActiveTab] = useState<Tab>('ledger');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [progress, setProgress] = useState<ProgressionState | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [earningSim, setEarningSim] = useState(false);

  // Payout modal state
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('10.00');
  const [payoutMethod, setPayoutMethod] = useState<
    'bank_transfer' | 'usdc_solana' | 'usdc_base' | 'gift_card' | 'partner_credit'
  >('bank_transfer');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [completedPayout, setCompletedPayout] = useState<PayoutRequest | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [earnFeedback, setEarnFeedback] = useState<{ permitted: boolean; reason?: string | null } | null>(null);

  const loadWalletData = async () => {
    setLoading(true);
    try {
      const [sum, prog, led] = await Promise.all([
        walletApi.getWalletSummary(USER_ID),
        walletApi.getProgression(USER_ID),
        walletApi.getWalletLedger(USER_ID, 1, 50)
      ]);
      setSummary(sum);
      setProgress(prog);
      setLedger(led.items);
    } catch (err) {
      console.warn('Failed to load wallet data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWalletData();
  }, []);

  // Simulate Event Earning
  const handleSimulateEarn = async () => {
    setEarningSim(true);
    setEarnFeedback(null);
    try {
      const simEventId = `evt-sim-${Date.now()}`;
      const res = await walletApi.recordEventEarnings(simEventId, USER_ID);
      setProgress(res.progression_update);
      setEarnFeedback({
        permitted: res.permitted,
        reason: res.denial_reason
      });
      // Reload summary and ledger
      const [sum, led] = await Promise.all([
        walletApi.getWalletSummary(USER_ID),
        walletApi.getWalletLedger(USER_ID, 1, 50)
      ]);
      setSummary(sum);
      setLedger(led.items);
    } catch (err) {
      console.warn('Error recording event earnings', err);
    } finally {
      setEarningSim(false);
    }
  };

  // Submit Payout
  const handleRequestPayout = async () => {
    const amt = parseFloat(payoutAmount);
    if (isNaN(amt) || amt <= 0) return;
    setPayoutSubmitting(true);
    setPayoutError(null);
    try {
      const res = await walletApi.requestPayout(USER_ID, amt, payoutMethod);
      if (!res.permitted) {
        setPayoutError(res.denial_reason ?? 'Payout request denied under current permissions policy');
        return;
      }
      if (res.payout) {
        setCompletedPayout(res.payout);
      }
      // Refresh wallet
      const [sum, led] = await Promise.all([
        walletApi.getWalletSummary(USER_ID),
        walletApi.getWalletLedger(USER_ID, 1, 50)
      ]);
      setSummary(sum);
      setLedger(led.items);
    } catch (err) {
      console.warn('Payout error', err);
      setPayoutError('Network error or server unavailable');
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const approvedBalance = summary ? (summary.total_earned - summary.total_settled) : 24.80;
  const xpPercent = progress ? Math.min(100, Math.round((progress.xp / progress.next_level_xp) * 100)) : 72;

  return (
    <Screen>
      <BrandHeader section="Rewards & Settlement Ledger" />

      {/* Main Balance Hero Card */}
      <View style={s.hero}>
        <View style={ui.row}>
          <View>
            <Text style={ui.label}>APPROVED BALANCE</Text>
            <Text style={s.balance}>${approvedBalance.toFixed(2)}</Text>
          </View>
          <View style={s.userBadge}>
            <Ionicons name="shield-checkmark" size={14} color={colors.green} />
            <Text style={s.userBadgeText}>ZERO-TRUST VERIFIED</Text>
          </View>
        </View>

        <Text style={s.heroSub}>
          Cryptographically backed rewards from verified research partners under purpose-minimized consent.
        </Text>

        <View style={s.line} />

        {/* Sub-Balances Grid */}
        <View style={s.subBalancesRow}>
          <View style={s.subBalanceItem}>
            <Text style={s.smallLabel}>PENDING GATES</Text>
            <Text style={[s.smallValue, { color: colors.orange }]}>
              ${summary?.total_pending.toFixed(2) ?? '4.20'}
            </Text>
          </View>
          <View style={s.subBalanceDivider} />
          <View style={s.subBalanceItem}>
            <Text style={s.smallLabel}>SETTLED (PAID)</Text>
            <Text style={[s.smallValue, { color: colors.text }]}>
              ${summary?.total_settled.toFixed(2) ?? '12.50'}
            </Text>
          </View>
          <View style={s.subBalanceDivider} />
          <View style={s.subBalanceItem}>
            <Text style={s.smallLabel}>LIFETIME EARNED</Text>
            <Text style={[s.smallValue, { color: colors.green }]}>
              ${summary?.total_earned.toFixed(2) ?? '37.30'}
            </Text>
          </View>
        </View>

        {/* Wallet Action Buttons */}
        <View style={s.heroActions}>
          <Pressable
            onPress={() => {
              setCompletedPayout(null);
              setPayoutError(null);
              setPayoutModalOpen(true);
            }}
            style={s.payoutBtn}
          >
            <Ionicons name="card-outline" size={16} color="#fff" />
            <Text style={s.payoutBtnText}>Request Payout</Text>
          </Pressable>

          <Pressable
            onPress={handleSimulateEarn}
            disabled={earningSim}
            style={[s.earnSimBtn, earningSim && s.btnDisabled]}
          >
            {earningSim ? (
              <ActivityIndicator size="small" color={colors.orange} />
            ) : (
              <>
                <Ionicons name="flash-outline" size={16} color={colors.orange} />
                <Text style={s.earnSimBtnText}>Simulate Telemetry Credit</Text>
              </>
            )}
          </Pressable>
        </View>

        {earnFeedback && (
          <View style={[s.feedbackBanner, earnFeedback.permitted ? s.feedbackBannerPermitted : s.feedbackBannerDenied]}>
            <Ionicons
              name={earnFeedback.permitted ? 'checkmark-circle' : 'alert-circle'}
              size={15}
              color={earnFeedback.permitted ? colors.green : '#ff7a7a'}
            />
            <Text style={[s.feedbackBannerText, earnFeedback.permitted ? s.feedbackTextPermitted : s.feedbackTextDenied]}>
              {earnFeedback.permitted
                ? 'Earnings calculated and credited (all permissions allowed)'
                : `Blocked by policy: ${earnFeedback.reason ?? 'Denied by permissions engine'}`}
            </Text>
          </View>
        )}
      </View>

      {/* Progression & Level Card */}
      <Card accent>
        <View style={ui.row}>
          <View style={s.levelRow}>
            <View style={s.levelBadge}>
              <Text style={s.levelNum}>LVL {progress?.level ?? 4}</Text>
            </View>
            <View>
              <Text style={s.rankTitle}>DATA SOVEREIGN</Text>
              <Text style={s.rankSub}>
                Top {100 - (progress?.percentile_rank ?? 94)}% Ecosystem Contributor
              </Text>
            </View>
          </View>
          <View style={s.xpTally}>
            <Text style={s.xpText}>
              {progress?.xp ?? 1450} / {progress?.next_level_xp ?? 2000} XP
            </Text>
          </View>
        </View>

        {/* XP Progress Bar */}
        <View style={s.xpTrack}>
          <View style={[s.xpFill, { width: `${xpPercent}%` }]} />
        </View>

        {/* Active Boosters Ribbon */}
        <View style={s.boostersRow}>
          <View style={s.boosterChip}>
            <Ionicons name="trending-up" size={12} color={colors.orange} />
            <Text style={s.boosterText}>
              Persona: {progress?.bonuses.persona_multiplier ?? 1.35}x
            </Text>
          </View>
          <View style={s.boosterChip}>
            <Ionicons name="flame" size={12} color={colors.orange} />
            <Text style={s.boosterText}>
              Streak: +{Math.round((progress?.bonuses.streak_bonus ?? 0.15) * 100)}%
            </Text>
          </View>
          <View style={s.boosterChip}>
            <Ionicons name="lock-closed" size={12} color={colors.green} />
            <Text style={s.boosterText}>
              Trust: +{Math.round((progress?.bonuses.trust_bonus ?? 0.10) * 100)}%
            </Text>
          </View>
        </View>

        {/* Milestones Unlocked */}
        <View style={s.milestonesBox}>
          <Text style={s.milestonesHeader}>UNLOCKED MILESTONES</Text>
          <View style={s.milestonesChipsRow}>
            {(progress?.milestones_unlocked ?? [
              'FIRST_SIGNAL_COMPENSATED',
              'METADATA_MINIMIZATION_CHAMPION',
              'STREAK_7_DAYS',
              'RESEARCH_PARTNER_VERIFIED'
            ]).map((m, i) => (
              <View key={i} style={s.milestonePill}>
                <Ionicons name="checkmark-circle" size={11} color={colors.green} />
                <Text style={s.milestoneText}>
                  {m.replace(/_/g, ' ')}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </Card>

      {/* Sub-Tabs: Ledger / By App / By Metadata */}
      <View style={s.tabBar}>
        <Pressable
          onPress={() => setActiveTab('ledger')}
          style={[s.tabItem, activeTab === 'ledger' && s.tabItemActive]}
        >
          <Ionicons
            name="receipt-outline"
            size={15}
            color={activeTab === 'ledger' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabText, activeTab === 'ledger' && s.tabTextActive]}>
            Ledger History
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('by_app')}
          style={[s.tabItem, activeTab === 'by_app' && s.tabItemActive]}
        >
          <Ionicons
            name="apps-outline"
            size={15}
            color={activeTab === 'by_app' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabText, activeTab === 'by_app' && s.tabTextActive]}>
            By App
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('by_metadata')}
          style={[s.tabItem, activeTab === 'by_metadata' && s.tabItemActive]}
        >
          <Ionicons
            name="cube-outline"
            size={15}
            color={activeTab === 'by_metadata' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabText, activeTab === 'by_metadata' && s.tabTextActive]}>
            By Metadata
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <Card>
          <View style={s.loadingBox}>
            <ActivityIndicator size="small" color={colors.orange} />
            <Text style={s.loadingText}>Syncing wallet ledger...</Text>
          </View>
        </Card>
      ) : (
        <>
          {/* TAB 1: LEDGER ENTRIES */}
          {activeTab === 'ledger' && (
            <View style={s.section}>
              <View style={ui.row}>
                <View>
                  <Text style={ui.eyebrow}>TRANSACTION LEDGER</Text>
                  <Text style={ui.h2}>Double-Entry Audit Log</Text>
                </View>
                <Text style={s.entriesCount}>{ledger.length} entries</Text>
              </View>

              {ledger.map(item => {
                const total = (item.value * item.multiplier) + item.bonus;
                const isDenied = item.permission_state === 'denied' || item.status === 'rejected';
                return (
                  <Card key={item.ledger_id}>
                    <View style={ui.row}>
                      <View style={s.appTag}>
                        <Ionicons name="phone-portrait-outline" size={13} color={colors.orange} />
                        <Text style={s.appTagText}>{item.app_id}</Text>
                      </View>
                      <View style={s.tagsRow}>
                        <View style={[
                          s.permTag,
                          isDenied ? s.permTagDenied : s.permTagPermitted
                        ]}>
                          <Ionicons
                            name={isDenied ? 'shield-outline' : 'shield-checkmark-outline'}
                            size={10}
                            color={isDenied ? '#ff8a8a' : colors.green}
                          />
                          <Text style={[s.permTagText, isDenied ? s.permTextDenied : s.permTextPermitted]}>
                            {isDenied ? 'DENIED' : 'PERMITTED'}
                          </Text>
                        </View>
                        <View style={[
                          s.statusTag,
                          item.status === 'approved' && s.statusApproved,
                          item.status === 'settled' && s.statusSettled,
                          item.status === 'pending' && s.statusPending,
                          item.status === 'rejected' && s.statusRejected
                        ]}>
                          <Text style={s.statusTagText}>{item.status.toUpperCase()}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={ui.row}>
                      <View style={s.flex1}>
                        <Text style={s.buyerCategory}>{item.buyer_category}</Text>
                        <Text style={s.metaTypes}>
                          Types: {item.metadata_types.join(', ')}
                        </Text>
                        {item.denial_reason && (
                          <View style={s.denialReasonBox}>
                            <Ionicons name="alert-circle-outline" size={12} color="#ff7a7a" />
                            <Text style={s.denialReasonText}>{item.denial_reason}</Text>
                          </View>
                        )}
                      </View>
                      <View style={s.entryValueCol}>
                        <Text style={[s.entryTotal, isDenied && s.entryTotalDenied]}>
                          {isDenied ? '$0.00' : `+$${total.toFixed(2)}`}
                        </Text>
                        <Text style={s.entryBreakdown}>
                          Base: ${item.value.toFixed(2)} · Multi: {item.multiplier}x
                        </Text>
                      </View>
                    </View>

                    <View style={s.entryFooter}>
                      <Text style={s.ledgerRef}>Ref: {item.ledger_id}</Text>
                      <Text style={s.entryTimestamp}>
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {/* TAB 2: BY APP */}
          {activeTab === 'by_app' && (
            <View style={s.section}>
              <View>
                <Text style={ui.eyebrow}>APP ATTRIBUTION</Text>
                <Text style={ui.h2}>Earnings by Monitored App</Text>
              </View>

              {summary && Object.entries(summary.earnings_by_app).map(([appId, amount]) => {
                const appPercent = summary.total_earned > 0 ? Math.min(100, Math.round((amount / summary.total_earned) * 100)) : 0;
                return (
                  <Card key={appId}>
                    <View style={ui.row}>
                      <View style={s.flex1}>
                        <Text style={s.itemHeading}>{appId}</Text>
                        <Text style={ui.body}>
                          {amount.toFixed(2)} USD ({appPercent}% of total revenue)
                        </Text>
                      </View>
                      <Text style={s.itemAmount}>${amount.toFixed(2)}</Text>
                    </View>

                    <View style={s.appTrack}>
                      <View style={[s.appFill, { width: `${appPercent}%` }]} />
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {/* TAB 3: BY METADATA TYPE */}
          {activeTab === 'by_metadata' && (
            <View style={s.section}>
              <View>
                <Text style={ui.eyebrow}>SIGNAL BREAKDOWN</Text>
                <Text style={ui.h2}>Earnings by Metadata Type</Text>
              </View>

              {summary && Object.entries(summary.earnings_by_metadata).map(([metaType, amount]) => {
                const metaPercent = summary.total_earned > 0 ? Math.min(100, Math.round((amount / summary.total_earned) * 100)) : 0;
                return (
                  <Card key={metaType}>
                    <View style={ui.row}>
                      <View style={s.flex1}>
                        <Text style={s.itemHeading}>{metaType.toUpperCase()}</Text>
                        <Text style={ui.body}>
                          Gated telemetry signal compensation
                        </Text>
                      </View>
                      <Text style={s.itemAmount}>${amount.toFixed(2)}</Text>
                    </View>

                    <View style={s.appTrack}>
                      <View style={[s.appFill, { width: `${metaPercent}%`, backgroundColor: colors.green }]} />
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* Production Standard Note */}
      <Card>
        <Text style={ui.eyebrow}>PRODUCTION SETTLEMENT ARCHITECTURE</Text>
        <Text style={ui.body}>
          KICK&apos;S operates double-entry cryptographic reconciliation. Every reward entry links verifiable observation signatures to research buyer escrow funds.
        </Text>
      </Card>

      {/* Payout Request Modal */}
      <Modal
        visible={payoutModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPayoutModalOpen(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={ui.row}>
              <Text style={ui.eyebrow}>PAYOUT DISBURSEMENT</Text>
              <Pressable onPress={() => setPayoutModalOpen(false)}>
                <Ionicons name="close-circle" size={24} color={colors.muted} />
              </Pressable>
            </View>

            {completedPayout ? (
              <View style={s.completedBox}>
                <Ionicons name="checkmark-done-circle" size={42} color={colors.green} />
                <Text style={s.completedTitle}>Payout Disbursed</Text>
                <Text style={s.completedSub}>
                  ${completedPayout.amount.toFixed(2)} sent via {completedPayout.method.replace('_', ' ')}.
                </Text>
                <Text style={s.completedRef}>Batch Ref: {completedPayout.payout_id}</Text>

                <Pressable
                  onPress={() => setPayoutModalOpen(false)}
                  style={s.doneBtn}
                >
                  <Text style={s.doneBtnText}>Close Receipt</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={ui.h2}>Disburse Available Balance</Text>
                <Text style={ui.body}>
                  Transfer approved rewards directly to your linked account or preferred redemption partner.
                </Text>

                {/* Amount input */}
                <View style={s.amountInputCard}>
                  <Text style={s.inputLabel}>AMOUNT (USD)</Text>
                  <View style={s.amountRow}>
                    <Text style={s.dollarSign}>$</Text>
                    <TextInput
                      value={payoutAmount}
                      onChangeText={setPayoutAmount}
                      keyboardType="decimal-pad"
                      style={s.amountInput}
                    />
                  </View>
                  <Text style={s.maxAvail}>
                    Max Available: ${approvedBalance.toFixed(2)}
                  </Text>
                </View>

                {/* Method selector */}
                <Text style={s.inputLabel}>DISBURSEMENT METHOD</Text>
                <View style={s.methodPicker}>
                  <Pressable
                    onPress={() => setPayoutMethod('bank_transfer')}
                    style={[s.methodChip, payoutMethod === 'bank_transfer' && s.methodChipActive]}
                  >
                    <Ionicons
                      name="business-outline"
                      size={14}
                      color={payoutMethod === 'bank_transfer' ? colors.orange : colors.muted}
                    />
                    <Text style={[s.methodText, payoutMethod === 'bank_transfer' && s.methodTextActive]}>
                      Bank ACH
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setPayoutMethod('usdc_solana')}
                    style={[s.methodChip, payoutMethod === 'usdc_solana' && s.methodChipActive]}
                  >
                    <Ionicons
                      name="logo-usd"
                      size={14}
                      color={payoutMethod === 'usdc_solana' ? colors.orange : colors.muted}
                    />
                    <Text style={[s.methodText, payoutMethod === 'usdc_solana' && s.methodTextActive]}>
                      USDC Solana
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setPayoutMethod('usdc_base')}
                    style={[s.methodChip, payoutMethod === 'usdc_base' && s.methodChipActive]}
                  >
                    <Ionicons
                      name="layers-outline"
                      size={14}
                      color={payoutMethod === 'usdc_base' ? colors.orange : colors.muted}
                    />
                    <Text style={[s.methodText, payoutMethod === 'usdc_base' && s.methodTextActive]}>
                      USDC Base
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setPayoutMethod('gift_card')}
                    style={[s.methodChip, payoutMethod === 'gift_card' && s.methodChipActive]}
                  >
                    <Ionicons
                      name="gift-outline"
                      size={14}
                      color={payoutMethod === 'gift_card' ? colors.orange : colors.muted}
                    />
                    <Text style={[s.methodText, payoutMethod === 'gift_card' && s.methodTextActive]}>
                      Gift Card
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setPayoutMethod('partner_credit')}
                    style={[s.methodChip, payoutMethod === 'partner_credit' && s.methodChipActive]}
                  >
                    <Ionicons
                      name="cube-outline"
                      size={14}
                      color={payoutMethod === 'partner_credit' ? colors.orange : colors.muted}
                    />
                    <Text style={[s.methodText, payoutMethod === 'partner_credit' && s.methodTextActive]}>
                      Credits
                    </Text>
                  </Pressable>
                </View>

                {payoutError && (
                  <View style={s.modalErrorBox}>
                    <Ionicons name="alert-circle" size={16} color="#ff6b6b" />
                    <Text style={s.modalErrorText}>{payoutError}</Text>
                  </View>
                )}

                <View style={s.modalActions}>
                  <Pressable
                    onPress={() => setPayoutModalOpen(false)}
                    style={s.modalCancelBtn}
                  >
                    <Text style={s.modalCancelText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    onPress={handleRequestPayout}
                    disabled={payoutSubmitting || parseFloat(payoutAmount) <= 0 || parseFloat(payoutAmount) > approvedBalance}
                    style={[
                      s.modalSubmitBtn,
                      (payoutSubmitting || parseFloat(payoutAmount) <= 0 || parseFloat(payoutAmount) > approvedBalance) && s.btnDisabled
                    ]}
                  >
                    {payoutSubmitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.modalSubmitText}>Confirm Payout</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: {
    backgroundColor: '#190d07',
    borderRadius: 22,
    padding: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: '#693214'
  },
  balance: {
    color: colors.orange,
    fontSize: 44,
    fontWeight: '900',
    marginTop: 2
  },
  heroSub: {
    color: '#bfa799',
    fontSize: 13,
    lineHeight: 18
  },
  line: {
    height: 1,
    backgroundColor: '#4d2b1a',
    marginVertical: 4
  },
  userBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0c2214',
    borderWidth: 1,
    borderColor: '#1d5a32',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8
  },
  userBadgeText: {
    color: colors.green,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  subBalancesRow: {
    flexDirection: 'row',
    backgroundColor: '#100804',
    borderWidth: 1,
    borderColor: '#381c0e',
    borderRadius: 12,
    padding: 10,
    marginTop: 2
  },
  subBalanceItem: {
    flex: 1,
    alignItems: 'center'
  },
  smallLabel: {
    color: '#8c7a70',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  smallValue: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3
  },
  subBalanceDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#381c0e'
  },
  heroActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8
  },
  payoutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.orange,
    paddingVertical: 12,
    borderRadius: 12
  },
  payoutBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900'
  },
  earnSimBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#261308',
    borderColor: '#632e12',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 12
  },
  earnSimBtnText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '800'
  },
  btnDisabled: {
    opacity: 0.5
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  levelBadge: {
    backgroundColor: colors.orange,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8
  },
  levelNum: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900'
  },
  rankTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  rankSub: {
    color: '#a89487',
    fontSize: 11,
    fontWeight: '600'
  },
  xpTally: {
    alignItems: 'flex-end'
  },
  xpText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '900',
    fontFamily: 'monospace'
  },
  xpTrack: {
    height: 8,
    backgroundColor: '#170c06',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#3b1c0c',
    overflow: 'hidden',
    marginTop: 4
  },
  xpFill: {
    height: '100%',
    backgroundColor: colors.orange,
    borderRadius: 4
  },
  boostersRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4
  },
  boosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1b0e06',
    borderWidth: 1,
    borderColor: '#4d240e',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  boosterText: {
    color: '#ffc599',
    fontSize: 10,
    fontWeight: '800'
  },
  milestonesBox: {
    backgroundColor: '#0c0c0e',
    borderWidth: 1,
    borderColor: '#242028',
    borderRadius: 10,
    padding: 10,
    gap: 6,
    marginTop: 6
  },
  milestonesHeader: {
    color: '#7f7168',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  milestonesChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  milestonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#111812',
    borderWidth: 1,
    borderColor: '#1e4028',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6
  },
  milestoneText: {
    color: '#a7d5b4',
    fontSize: 9,
    fontWeight: '700'
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0c0c0e',
    borderWidth: 1,
    borderColor: '#242028',
    borderRadius: 14,
    padding: 4,
    marginVertical: 4
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10
  },
  tabItemActive: {
    backgroundColor: '#201209',
    borderWidth: 1,
    borderColor: '#592c13'
  },
  tabText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  tabTextActive: {
    color: colors.orange,
    fontWeight: '800'
  },
  section: {
    gap: 10
  },
  entriesCount: {
    color: '#8c7b72',
    fontSize: 11,
    fontWeight: '700'
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600'
  },
  appTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a100a',
    borderWidth: 1,
    borderColor: '#422415',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6
  },
  appTagText: {
    color: '#ffc8a3',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700'
  },
  statusTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1
  },
  statusApproved: {
    backgroundColor: '#0c2214',
    borderColor: '#1d5a32'
  },
  statusSettled: {
    backgroundColor: '#121820',
    borderColor: '#203c58'
  },
  statusPending: {
    backgroundColor: '#261609',
    borderColor: '#6b3614'
  },
  statusTagText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: '900'
  },
  flex1: {
    flex: 1
  },
  buyerCategory: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800'
  },
  metaTypes: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2
  },
  entryValueCol: {
    alignItems: 'flex-end'
  },
  entryTotal: {
    color: colors.green,
    fontSize: 17,
    fontWeight: '900'
  },
  entryBreakdown: {
    color: '#857469',
    fontSize: 10,
    marginTop: 2
  },
  entryFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#242028',
    paddingTop: 6,
    marginTop: 4
  },
  ledgerRef: {
    color: '#70645c',
    fontSize: 10,
    fontFamily: 'monospace'
  },
  entryTimestamp: {
    color: '#8f7e74',
    fontSize: 10,
    fontWeight: '600'
  },
  itemHeading: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  itemAmount: {
    color: colors.orange,
    fontSize: 18,
    fontWeight: '900'
  },
  appTrack: {
    height: 6,
    backgroundColor: '#100a06',
    borderWidth: 1,
    borderColor: '#2d160a',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8
  },
  appFill: {
    height: '100%',
    backgroundColor: colors.orange,
    borderRadius: 3
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#5e2e13',
    borderRadius: 20,
    padding: 20,
    gap: 12
  },
  inputLabel: {
    color: '#8f7d73',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  amountInputCard: {
    backgroundColor: '#0c0c0e',
    borderWidth: 1,
    borderColor: '#27222b',
    borderRadius: 12,
    padding: 12,
    gap: 4
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  dollarSign: {
    color: colors.orange,
    fontSize: 28,
    fontWeight: '900'
  },
  amountInput: {
    flex: 1,
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    padding: 0
  },
  maxAvail: {
    color: '#82746b',
    fontSize: 11,
    fontWeight: '700'
  },
  methodPicker: {
    flexDirection: 'row',
    gap: 8
  },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#0d0d10',
    borderWidth: 1,
    borderColor: '#26222b',
    paddingVertical: 10,
    borderRadius: 10
  },
  methodChipActive: {
    backgroundColor: '#261308',
    borderColor: '#7a3814'
  },
  methodText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  methodTextActive: {
    color: colors.orange,
    fontWeight: '900'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#39333c',
    alignItems: 'center'
  },
  modalCancelText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  modalSubmitBtn: {
    flex: 1.5,
    backgroundColor: colors.orange,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center'
  },
  modalSubmitText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900'
  },
  completedBox: {
    alignItems: 'center',
    backgroundColor: '#0a1a10',
    borderWidth: 1,
    borderColor: '#194d2c',
    borderRadius: 14,
    padding: 20,
    gap: 6
  },
  completedTitle: {
    color: colors.green,
    fontSize: 18,
    fontWeight: '900'
  },
  completedSub: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  completedRef: {
    color: '#7ba88a',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2
  },
  doneBtn: {
    backgroundColor: colors.green,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 10
  },
  doneBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900'
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4
  },
  feedbackBannerPermitted: {
    backgroundColor: '#0a1d12',
    borderColor: '#1e5230'
  },
  feedbackBannerDenied: {
    backgroundColor: '#260d0d',
    borderColor: '#5e1d1d'
  },
  feedbackBannerText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1
  },
  feedbackTextPermitted: {
    color: '#8be2a4'
  },
  feedbackTextDenied: {
    color: '#ff9e9e'
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  permTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1
  },
  permTagPermitted: {
    backgroundColor: '#0a1d12',
    borderColor: '#1e5230'
  },
  permTagDenied: {
    backgroundColor: '#2a0e0e',
    borderColor: '#6b1c1c'
  },
  permTagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  permTextPermitted: {
    color: colors.green
  },
  permTextDenied: {
    color: '#ff8a8a'
  },
  statusRejected: {
    backgroundColor: '#2b1010',
    borderColor: '#661b1b'
  },
  entryTotalDenied: {
    color: '#82746b',
    textDecorationLine: 'line-through'
  },
  denialReasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#260c0c',
    borderWidth: 1,
    borderColor: '#541515',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    marginTop: 4
  },
  denialReasonText: {
    color: '#ff9999',
    fontSize: 10,
    fontWeight: '700',
    flex: 1
  },
  modalErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#290d0d',
    borderWidth: 1,
    borderColor: '#691e1e',
    borderRadius: 10,
    padding: 10
  },
  modalErrorText: {
    color: '#ff9999',
    fontSize: 12,
    fontWeight: '700',
    flex: 1
  }
});

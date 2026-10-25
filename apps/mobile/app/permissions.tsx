import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import {
  ConsentAction,
  ConsentApiError,
  ConsentDecisionRequest,
  ConsentHistoryEvent,
  ConsentSession,
  getConsentApiBaseUrl,
  getConsentHistory,
  getConsentSession,
  recordConsentDecision,
  stableConsentRequestId,
  stableConsentUuid
} from '../services/consentApi';
import {
  AppPermission,
  BuyerPermission,
  MetadataPermission,
  permissionsApi
} from '../services/permissionsApi';

type Tab = 'apps' | 'metadata' | 'buyers' | 'history';
type LoadState = 'loading' | 'ready' | 'missing-session' | 'offline' | 'error';
type PermissionCategory = 'app' | 'metadata' | 'buyer';
type ConsentItem = {
  id: string;
  key: string;
  category: PermissionCategory;
  title: string;
  detail: string;
  purpose: string;
  events: ConsentHistoryEvent[];
  historyStatus: 'loading' | 'ready' | 'error';
};
type ActionStatus = {
  id: string;
  state: 'saving' | 'success' | 'stale' | 'offline' | 'error';
  message: string;
};

const POLICY_VERSION = 'privacy-1';
const PURPOSE_VERSION = 'purpose-1';
function latestSequence(events: ConsentHistoryEvent[]): number {
  return events.reduce((sequence, event) => Math.max(sequence, event.eventSequence ?? 0), 0);
}

function consentState(events: ConsentHistoryEvent[]): string {
  const latest = [...events].sort((a, b) =>
    (b.eventSequence ?? 0) - (a.eventSequence ?? 0)
  )[0];
  if (!latest) return 'No decision recorded';
  if (latest.action === 'grant') return 'Granted by consent event';
  if (latest.action === 'deny') return 'Denied by consent event';
  return 'Consent revoked';
}

function makeItem(
  session: ConsentSession,
  category: PermissionCategory,
  key: string,
  title: string,
  detail: string,
  purpose: string
): ConsentItem {
  return {
    id: stableConsentUuid('kicks-permission-v1', session.subjectId, category, key),
    key,
    category,
    title,
    detail,
    purpose,
    events: [],
    historyStatus: 'loading'
  };
}

export default function Permissions() {
  const [activeTab, setActiveTab] = useState<Tab>('apps');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [items, setItems] = useState<ConsentItem[]>([]);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const pendingRequests = useRef(new Map<string, { action: ConsentAction; decision: ConsentDecisionRequest }>());

  const loadData = useCallback(async () => {
    setLoadState('loading');
    setActionStatus(null);
    try {
      const session = await getConsentSession();
      if (!session) {
        setItems([]);
        setLoadState('missing-session');
        return;
      }

      const [apps, buyers] = await Promise.all([
        permissionsApi.getAppPermissions(session.subjectId),
        permissionsApi.getBuyerPermissions(session.subjectId)
      ]);
      const metadataGroups = await Promise.all(apps.map(async app => ({
        app,
        metadata: await permissionsApi.getMetadataPermissions(session.subjectId, app.app_id)
      })));
      const catalog: ConsentItem[] = [
        ...apps.map((app: AppPermission) => makeItem(
          session, 'app', app.app_id, app.app_name, app.app_id,
          `Allow app access for ${app.app_name}`
        )),
        ...metadataGroups.flatMap(({ app, metadata }) =>
          metadata.map((meta: MetadataPermission) => makeItem(
            session,
            'metadata',
            `${app.app_id}:${meta.metadata_type}:${meta.key ?? ''}`,
            `${meta.metadata_type} · ${app.app_name}`,
            `Signal key: ${meta.key || 'all category signals'}`,
            `Use ${meta.metadata_type} metadata for ${app.app_name}`
          ))
        ),
        ...buyers.map((buyer: BuyerPermission) => makeItem(
          session,
          'buyer',
          buyer.buyer_category,
          buyer.buyer_category,
          'Buyer-category sharing purpose',
          `Share approved data with ${buyer.buyer_category}`
        ))
      ];
      setItems(catalog);
      const apiBaseUrl = getConsentApiBaseUrl();
      const histories = await Promise.all(catalog.map(async item => {
        try {
          const history = await getConsentHistory(apiBaseUrl, session.deviceToken, item.id);
          return { ...item, events: history.events, historyStatus: 'ready' as const };
        } catch {
          return { ...item, historyStatus: 'error' as const };
        }
      }));
      setItems(histories);
      const failed = histories.filter(item => item.historyStatus === 'error').length;
      setLoadState(failed === histories.length && histories.length > 0 ? 'offline' : 'ready');
    } catch (error) {
      setLoadState(error instanceof ConsentApiError && error.retryable ? 'offline' : 'error');
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshCount]);

  const refreshItemHistory = async (
    session: ConsentSession,
    apiBaseUrl: string,
    item: ConsentItem
  ) => getConsentHistory(apiBaseUrl, session.deviceToken, item.id);

  const submitDecision = async (item: ConsentItem, action: ConsentAction) => {
    if (busyId) return;
    const pending = pendingRequests.current.get(item.id);
    if (pending && pending.action !== action) {
      setActionStatus({
        id: item.id,
        state: 'error',
        message: 'A previous decision is still unconfirmed. Retry that same action first so its request ID and payload remain stable.'
      });
      return;
    }
    setBusyId(item.id);
    setActionStatus({ id: item.id, state: 'saving', message: 'Saving decision to the consent service…' });
    try {
      const session = await getConsentSession();
      if (!session) throw new ConsentApiError('Authenticated device session is unavailable.', 0, false, 'identity_required');
      const apiBaseUrl = getConsentApiBaseUrl();
      const current = await refreshItemHistory(session, apiBaseUrl, item);
      let decision: ConsentDecisionRequest;
      if (pending) {
        const replay = current.events.find(event => event.requestId === pending.decision.requestId);
        if (replay) {
          pendingRequests.current.delete(item.id);
          setItems(currentItems => currentItems.map(currentItem =>
            currentItem.id === item.id
              ? { ...currentItem, events: current.events, historyStatus: 'ready' }
              : currentItem
          ));
          setActionStatus({
            id: item.id,
            state: 'success',
            message: 'This decision was persisted by the service; the matching request ID was found in history.'
          });
          return;
        }
        decision = pending.decision;
      } else {
        const latest = [...current.events].sort((a, b) =>
          (b.eventSequence ?? 0) - (a.eventSequence ?? 0)
        )[0];
        if (latest?.action === action) {
          setItems(currentItems => currentItems.map(currentItem =>
            currentItem.id === item.id
              ? { ...currentItem, events: current.events, historyStatus: 'ready' }
              : currentItem
          ));
          setActionStatus({
            id: item.id,
            state: 'success',
            message: 'This same decision is already recorded in server history; no duplicate event was submitted.'
          });
          return;
        }
        const expectedEventSequence = latestSequence(current.events);
        decision = {
          permissionId: item.id,
          requestId: stableConsentRequestId(
            item.id, expectedEventSequence, action, POLICY_VERSION, PURPOSE_VERSION
          ),
          expectedEventSequence,
          action,
          policyVersion: POLICY_VERSION,
          purposeVersion: PURPOSE_VERSION,
          purpose: item.purpose
        };
        pendingRequests.current.set(item.id, { action, decision });
      }
      const response = await recordConsentDecision(apiBaseUrl, session.deviceToken, decision);
      pendingRequests.current.delete(item.id);
      const expectedEventSequence = decision.expectedEventSequence;
      if (response.eventSequence !== undefined &&
        response.eventSequence !== expectedEventSequence + 1 &&
        !response.idempotentReplay) {
        throw new ConsentApiError('The saved sequence did not match the expected event. Refresh before retrying.', 409, false, 'stale_consent_decision');
      }
      try {
        const confirmed = await refreshItemHistory(session, apiBaseUrl, item);
        setItems(currentItems => currentItems.map(currentItem =>
          currentItem.id === item.id
            ? { ...currentItem, events: confirmed.events, historyStatus: 'ready' }
            : currentItem
        ));
        setActionStatus({
          id: item.id,
          state: 'success',
          message: response.idempotentReplay
            ? 'This exact decision was already saved by the service.'
            : 'Decision saved and confirmed in durable consent history.'
        });
      } catch {
        setItems(currentItems => currentItems.map(currentItem =>
          currentItem.id === item.id ? { ...currentItem, historyStatus: 'error' } : currentItem
        ));
        setActionStatus({
          id: item.id,
          state: 'success',
          message: 'The consent service accepted this decision, but the follow-up history read failed. Refresh to verify the latest event sequence.'
        });
      }
    } catch (error) {
      const consentError = error instanceof ConsentApiError ? error : null;
      const isStale = consentError?.status === 409 || consentError?.code === 'stale_consent_decision';
      const isOffline = consentError?.retryable === true || consentError?.status === 0 || consentError?.status === 503;
      if (isStale || !isOffline) pendingRequests.current.delete(item.id);
      setActionStatus({
        id: item.id,
        state: isStale ? 'stale' : isOffline ? 'offline' : 'error',
        message: isStale
          ? 'This decision is stale. No local change was applied; refresh to read the latest server sequence.'
          : isOffline
            ? 'Consent service is offline. No decision is shown as saved; retry when the service is available.'
            : `Decision was not confirmed by the service${consentError?.message ? `: ${consentError.message}` : '.'}`
      });
      if (isStale || isOffline) {
        setItems(currentItems => currentItems.map(currentItem =>
          currentItem.id === item.id ? { ...currentItem, historyStatus: 'error' } : currentItem
        ));
      }
    } finally {
      setBusyId(null);
    }
  };

  const categoryForTab: Partial<Record<Tab, PermissionCategory>> = {
    apps: 'app',
    metadata: 'metadata',
    buyers: 'buyer'
  };
  const visibleItems = items.filter(item => item.category === categoryForTab[activeTab]);
  const allEvents = items.flatMap(item => item.events.map(event => ({ ...event, item })))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  return (
    <Screen>
      <BrandHeader section="Permission & Consent History" />
      <View style={s.hero}>
        <Text style={ui.eyebrow}>SERVER-RECORDED CONSENT</Text>
        <Text style={s.heroTitle}>Your choices, on record.</Text>
        <Text style={ui.body}>
          Grant, deny, or revoke purpose-specific consent. A confirmed consent event is not Android OS authorization and does not enable or start the collector.
        </Text>
      </View>

      {loadState === 'loading' && (
        <Card>
          <View style={s.statusRow}>
            <ActivityIndicator size="small" color={colors.orange} />
            <Text style={s.statusText}>Reading consent history from the service…</Text>
          </View>
        </Card>
      )}
      {loadState === 'missing-session' && (
        <StatusCard
          tone="error"
          text="No authenticated device session is available. Sign in or enroll through the secure session flow to read or change server consent. No permission is assumed."
          retryLabel="Retry secure session"
          onRetry={() => setRefreshCount(value => value + 1)}
        />
      )}
      {loadState === 'offline' && (
        <StatusCard
          tone="warning"
          text="Consent history is unavailable or offline. Existing choices are not treated as current authorization. Retry to read the server."
          onRetry={() => setRefreshCount(value => value + 1)}
        />
      )}
      {loadState === 'error' && (
        <StatusCard
          tone="error"
          text="Permission catalog or consent service could not be read. No local permission state was applied."
          onRetry={() => setRefreshCount(value => value + 1)}
        />
      )}
      {loadState === 'ready' && (
        <>
          <View style={s.tabBar}>
            {([
              ['apps', 'Apps'],
              ['metadata', 'Metadata'],
              ['buyers', 'Buyers'],
              ['history', 'History']
            ] as const).map(([tab, title]) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab }}
                onPress={() => setActiveTab(tab)}
                style={[s.tab, activeTab === tab && s.activeTab]}
              >
                <Text style={[s.tabText, activeTab === tab && s.activeTabText]}>{title}</Text>
              </Pressable>
            ))}
          </View>

          {activeTab === 'history' ? (
            <View style={s.section}>
              <Text style={ui.h2}>Consent event history</Text>
              {allEvents.length === 0 && <Text style={s.empty}>No server-recorded consent decisions.</Text>}
              {allEvents.map(({ item, ...event }) => (
                <Card key={event.id}>
                  <Text style={s.itemTitle}>{item.title}</Text>
                  <Text style={s.detail}>{event.action.toUpperCase()} · sequence {event.eventSequence ?? 'unknown'}</Text>
                  <Text style={s.detail}>{event.purpose}</Text>
                  <Text style={s.timestamp}>{new Date(event.occurredAt).toLocaleString()}</Text>
                  <Text style={s.eventId}>Event {event.id}</Text>
                </Card>
              ))}
            </View>
          ) : (
            <View style={s.section}>
              <View style={s.sectionHeading}>
                <View style={s.flex}>
                  <Text style={ui.eyebrow}>DURABLE CONSENT EVENTS</Text>
                  <Text style={ui.h2}>{tabTitle(activeTab)} choices</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setRefreshCount(value => value + 1)}>
                  <Text style={s.refresh}>Refresh</Text>
                </Pressable>
              </View>
              {visibleItems.length === 0 && (
                <Text style={s.empty}>No {tabTitle(activeTab).toLowerCase()} choices are available from the permission catalog.</Text>
              )}
              {visibleItems.map(item => (
                <Card key={item.id}>
                  <View style={s.itemHeader}>
                    <View style={s.flex}>
                      <Text style={s.itemTitle}>{item.title}</Text>
                      <Text style={s.detail}>{item.detail}</Text>
                    </View>
                    <View style={s.statePill}>
                      <Text style={s.stateText}>
                        {item.historyStatus === 'ready' ? consentState(item.events) : 'History unavailable'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.purpose}>Purpose: {item.purpose}</Text>
                  <Text style={s.sequence}>
                    {item.historyStatus === 'ready'
                      ? `Server event sequence ${latestSequence(item.events)}`
                      : 'No current sequence confirmed'}
                  </Text>
                  <View style={s.actionRow}>
                    {(['grant', 'deny', 'revoke'] as const).map(action => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${action} consent for ${item.title}`}
                        key={action}
                        disabled={busyId !== null || loadState !== 'ready'}
                        onPress={() => void submitDecision(item, action)}
                        style={[
                          s.actionButton,
                          action === 'grant' && s.grantButton,
                          action === 'deny' && s.denyButton,
                          action === 'revoke' && s.revokeButton,
                          busyId !== null && s.disabled
                        ]}
                      >
                        <Text style={s.actionText}>{action.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {actionStatus?.id === item.id && (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={[
                        s.notice,
                        actionStatus.state === 'success' && s.success,
                        actionStatus.state === 'stale' && s.warning,
                        actionStatus.state === 'offline' && s.warning,
                        actionStatus.state === 'error' && s.error
                      ]}
                    >
                      {actionStatus.message}
                    </Text>
                  )}
                </Card>
              ))}
            </View>
          )}
        </>
      )}
      <Text style={s.footer}>
        Consent state is read from authenticated server history only. This screen does not enable monitoring or claim device-level permission.
      </Text>
    </Screen>
  );
}

function tabTitle(tab: Tab): string {
  if (tab === 'apps') return 'App';
  if (tab === 'metadata') return 'Metadata';
  if (tab === 'buyers') return 'Buyer';
  return 'Consent';
}

function StatusCard({
  tone,
  text,
  onRetry,
  retryLabel = 'Retry server read'
}: {
  tone: 'error' | 'warning';
  text: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Card>
      <Text style={tone === 'error' ? s.error : s.warning}>{text}</Text>
      {onRetry && (
        <Pressable accessibilityRole="button" onPress={onRetry} style={s.retryButton}>
          <Text style={s.retryText}>{retryLabel}</Text>
        </Pressable>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: '#170c07', borderRadius: 18, borderWidth: 1, borderColor: '#612e12', padding: 17, gap: 7 },
  heroTitle: { color: colors.text, fontSize: 23, fontWeight: '900' },
  tabBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tab: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 99, borderWidth: 1, borderColor: '#342a24' },
  activeTab: { backgroundColor: '#251208', borderColor: colors.orange },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  activeTabText: { color: colors.orange },
  section: { gap: 11 },
  sectionHeading: { ...ui.row, gap: 10 },
  flex: { flex: 1 },
  itemHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  itemTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  statePill: { maxWidth: 145, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: '#201710' },
  stateText: { color: '#f2c89e', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  purpose: { color: colors.text, fontSize: 12, lineHeight: 18 },
  sequence: { color: colors.muted, fontSize: 10 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 3 },
  actionButton: { borderWidth: 1, borderColor: '#4b4039', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  grantButton: { borderColor: colors.green },
  denyButton: { borderColor: colors.red },
  revokeButton: { borderColor: colors.orange },
  actionText: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  disabled: { opacity: 0.45 },
  notice: { fontSize: 12, lineHeight: 17 },
  success: { color: colors.green },
  warning: { color: '#ffc174' },
  error: { color: colors.red },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusText: { color: colors.muted, fontSize: 12 },
  retryButton: { alignSelf: 'flex-start', padding: 5 },
  retryText: { color: colors.blue, fontSize: 12, fontWeight: '800' },
  refresh: { color: colors.blue, fontSize: 12, fontWeight: '800', padding: 6 },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
  timestamp: { color: colors.muted, fontSize: 10 },
  eventId: { color: '#786a61', fontSize: 9 },
  footer: { color: '#8e8179', fontSize: 10, lineHeight: 15 }
});

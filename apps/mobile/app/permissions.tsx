import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrandHeader, Card, Screen, colors, ui } from '../components/Brand';
import {
  AppPermission,
  BuyerPermission,
  ConsentLogEntry,
  EffectivePermissionsView,
  MetadataPermission,
  MetadataState,
  permissionsApi,
  PermissionState
} from '../services/permissionsApi';

const USER_ID = 'user_demo_01';

type Tab = 'apps' | 'metadata' | 'buyers' | 'audit_log';

export default function Permissions() {
  const [activeTab, setActiveTab] = useState<Tab>('apps');
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<AppPermission[]>([]);
  const [selectedAppId, setSelectedAppId] = useState('com.example.shop');
  const [metadataPerms, setMetadataPerms] = useState<MetadataPermission[]>([]);
  const [buyers, setBuyers] = useState<BuyerPermission[]>([]);
  const [effective, setEffective] = useState<EffectivePermissionsView | null>(null);
  const [consentLogs, setConsentLogs] = useState<ConsentLogEntry[]>([]);
  const [actionInProgress, setActionInProgress] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [appData, buyerData, effectiveData, logData] = await Promise.all([
        permissionsApi.getAppPermissions(USER_ID),
        permissionsApi.getBuyerPermissions(USER_ID),
        permissionsApi.getEffectivePermissions(USER_ID),
        permissionsApi.getConsentLog(USER_ID, 1, 30)
      ]);
      setApps(appData);
      setBuyers(buyerData);
      setEffective(effectiveData);
      setConsentLogs(logData.items);

      if (appData.length > 0) {
        const currentApp = selectedAppId || appData[0]?.app_id || 'com.example.shop';
        setSelectedAppId(currentApp);
        const meta = await permissionsApi.getMetadataPermissions(USER_ID, currentApp);
        setMetadataPerms(meta);
      }
    } catch (err) {
      console.warn('Failed to load permissions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectApp = async (appId: string) => {
    setSelectedAppId(appId);
    setActionInProgress(true);
    try {
      const meta = await permissionsApi.getMetadataPermissions(USER_ID, appId);
      setMetadataPerms(meta);
    } catch (err) {
      console.warn('Failed to load metadata perms', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleUpdateAppState = async (appId: string, newState: PermissionState) => {
    setActionInProgress(true);
    try {
      const updatedApps = apps.map(a =>
        a.app_id === appId
          ? { ...a, state: newState, reason: `Updated by user to ${newState}` }
          : a
      );
      const res = await permissionsApi.setAppPermissions(USER_ID, updatedApps);
      setApps(res);

      // Refresh effective & audit log
      const [eff, logs] = await Promise.all([
        permissionsApi.getEffectivePermissions(USER_ID),
        permissionsApi.getConsentLog(USER_ID, 1, 30)
      ]);
      setEffective(eff);
      setConsentLogs(logs.items);
    } catch (err) {
      console.warn('Failed to update app state', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleUpdateMetadataState = async (mtype: string, newState: MetadataState) => {
    setActionInProgress(true);
    try {
      const updated = metadataPerms.map(m =>
        m.metadata_type === mtype
          ? { ...m, state: newState }
          : m
      );
      const res = await permissionsApi.setMetadataPermissions(USER_ID, selectedAppId, updated);
      setMetadataPerms(res);

      // Refresh effective & audit log
      const [eff, logs] = await Promise.all([
        permissionsApi.getEffectivePermissions(USER_ID),
        permissionsApi.getConsentLog(USER_ID, 1, 30)
      ]);
      setEffective(eff);
      setConsentLogs(logs.items);
    } catch (err) {
      console.warn('Failed to update metadata state', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleUpdateBuyerState = async (bcategory: string, newState: PermissionState) => {
    setActionInProgress(true);
    try {
      const updated = buyers.map(b =>
        b.buyer_category === bcategory
          ? { ...b, state: newState }
          : b
      );
      const res = await permissionsApi.setBuyerPermissions(USER_ID, updated);
      setBuyers(res);

      // Refresh effective & audit log
      const [eff, logs] = await Promise.all([
        permissionsApi.getEffectivePermissions(USER_ID),
        permissionsApi.getConsentLog(USER_ID, 1, 30)
      ]);
      setEffective(eff);
      setConsentLogs(logs.items);
    } catch (err) {
      console.warn('Failed to update buyer state', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleUpdateBuyerBand = async (bcategory: string, newBand: number) => {
    setActionInProgress(true);
    try {
      const updated = buyers.map(b =>
        b.buyer_category === bcategory
          ? { ...b, max_value_band: Math.max(0, Math.min(100, newBand)) }
          : b
      );
      const res = await permissionsApi.setBuyerPermissions(USER_ID, updated);
      setBuyers(res);

      const [eff, logs] = await Promise.all([
        permissionsApi.getEffectivePermissions(USER_ID),
        permissionsApi.getConsentLog(USER_ID, 1, 30)
      ]);
      setEffective(eff);
      setConsentLogs(logs.items);
    } catch (err) {
      console.warn('Failed to update buyer band', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCycleBuyerOverride = async (
    mtype: string,
    buyerCategory: string,
    currentState: MetadataState
  ) => {
    const nextState: MetadataState =
      currentState === 'allowed'
        ? 'conditional'
        : currentState === 'conditional'
          ? 'blocked'
          : 'allowed';

    setActionInProgress(true);
    try {
      const updated = metadataPerms.map(m => {
        if (m.metadata_type !== mtype) return m;
        const currentOverrides = m.buyer_overrides ?? [];
        const exists = currentOverrides.some(o => o.buyer_category === buyerCategory);
        const newOverrides = exists
          ? currentOverrides.map(o =>
              o.buyer_category === buyerCategory ? { ...o, state: nextState } : o
            )
          : [...currentOverrides, { buyer_category: buyerCategory, state: nextState }];
        return { ...m, buyer_overrides: newOverrides };
      });
      const res = await permissionsApi.setMetadataPermissions(USER_ID, selectedAppId, updated);
      setMetadataPerms(res);

      const [eff, logs] = await Promise.all([
        permissionsApi.getEffectivePermissions(USER_ID),
        permissionsApi.getConsentLog(USER_ID, 1, 30)
      ]);
      setEffective(eff);
      setConsentLogs(logs.items);
    } catch (err) {
      console.warn('Failed to update override', err);
    } finally {
      setActionInProgress(false);
    }
  };

  const allowedAppsCount = apps.filter(a => a.state === 'allowed').length;
  const blockedBuyersCount = buyers.filter(b => b.state === 'blocked').length;

  return (
    <Screen>
      <BrandHeader section="Permission & Consent Engine" />

      {/* Hero Card */}
      <View style={s.hero}>
        <View style={ui.row}>
          <View>
            <Text style={ui.label}>ENFORCEMENT ENGINE</Text>
            <Text style={s.heroTitle}>Zero-Trust Gatekeeper</Text>
          </View>
          <View style={s.statusPill}>
            <Ionicons name="shield-checkmark" size={13} color={colors.green} />
            <Text style={s.statusPillText}>ACTIVE ENFORCEMENT</Text>
          </View>
        </View>

        <Text style={s.heroSub}>
          Dynamic consent governance. Every app, telemetry field, and buyer access request is evaluated against cryptographic minimization boundaries.
        </Text>

        <View style={s.divider} />

        {/* Quick Stats Grid */}
        <View style={s.statsGrid}>
          <View style={s.statItem}>
            <Text style={s.statNum}>{allowedAppsCount}</Text>
            <Text style={s.statLabel}>ALLOWED APPS</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statNum}>{blockedBuyersCount}</Text>
            <Text style={s.statLabel}>BLOCKED BUYERS</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.statItem}>
            <Text style={s.statNum}>{consentLogs.length}</Text>
            <Text style={s.statLabel}>AUDIT ENTRIES</Text>
          </View>
        </View>
      </View>

      {/* Main Tabs */}
      <View style={s.tabBar}>
        <Pressable
          onPress={() => setActiveTab('apps')}
          style={[s.tabBtn, activeTab === 'apps' && s.tabBtnActive]}
        >
          <Ionicons
            name="apps-outline"
            size={14}
            color={activeTab === 'apps' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabBtnText, activeTab === 'apps' && s.tabBtnTextActive]}>
            Apps
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('metadata')}
          style={[s.tabBtn, activeTab === 'metadata' && s.tabBtnActive]}
        >
          <Ionicons
            name="cube-outline"
            size={14}
            color={activeTab === 'metadata' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabBtnText, activeTab === 'metadata' && s.tabBtnTextActive]}>
            Metadata
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('buyers')}
          style={[s.tabBtn, activeTab === 'buyers' && s.tabBtnActive]}
        >
          <Ionicons
            name="business-outline"
            size={14}
            color={activeTab === 'buyers' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabBtnText, activeTab === 'buyers' && s.tabBtnTextActive]}>
            Buyers
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab('audit_log')}
          style={[s.tabBtn, activeTab === 'audit_log' && s.tabBtnActive]}
        >
          <Ionicons
            name="receipt-outline"
            size={14}
            color={activeTab === 'audit_log' ? colors.orange : colors.muted}
          />
          <Text style={[s.tabBtnText, activeTab === 'audit_log' && s.tabBtnTextActive]}>
            Consent Log
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <Card>
          <View style={s.loadingBox}>
            <ActivityIndicator size="small" color={colors.orange} />
            <Text style={s.loadingText}>Syncing permissions state...</Text>
          </View>
        </Card>
      ) : (
        <>
          {/* TAB 1: MONITORED APPS */}
          {activeTab === 'apps' && (
            <View style={s.section}>
              <View style={ui.row}>
                <View>
                  <Text style={ui.eyebrow}>APP-LEVEL CONTROLS</Text>
                  <Text style={ui.h2}>Monitored Client Applications</Text>
                </View>
                {actionInProgress && <ActivityIndicator size="small" color={colors.orange} />}
              </View>

              {apps.map(app => {
                const isAllowed = app.state === 'allowed';
                const isLimited = app.state === 'limited';
                const isBlocked = app.state === 'blocked';

                return (
                  <Card key={app.app_id} accent={isAllowed}>
                    <View style={ui.row}>
                      <View style={s.flex1}>
                        <Text style={s.appName}>{app.app_name}</Text>
                        <Text style={s.appId}>{app.app_id}</Text>
                      </View>
                      <View style={[
                        s.stateBadge,
                        isAllowed && s.stateAllowed,
                        isLimited && s.stateLimited,
                        isBlocked && s.stateBlocked
                      ]}>
                        <Text style={s.stateBadgeText}>{app.state.toUpperCase()}</Text>
                      </View>
                    </View>

                    {app.reason && (
                      <Text style={s.reasonText}>
                        <Ionicons name="information-circle-outline" size={13} color="#948479" />
                        {' '}{app.reason}
                      </Text>
                    )}

                    {/* State Selector Buttons */}
                    <View style={s.stateBtnGroup}>
                      <Pressable
                        onPress={() => handleUpdateAppState(app.app_id, 'allowed')}
                        style={[s.miniToggle, isAllowed && s.miniToggleActiveAllowed]}
                      >
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color={isAllowed ? '#0c2214' : colors.muted}
                        />
                        <Text style={[s.miniToggleText, isAllowed && s.miniToggleTextActiveAllowed]}>
                          Allow
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleUpdateAppState(app.app_id, 'limited')}
                        style={[s.miniToggle, isLimited && s.miniToggleActiveLimited]}
                      >
                        <Ionicons
                          name="shield-half"
                          size={12}
                          color={isLimited ? '#ff8c3b' : colors.muted}
                        />
                        <Text style={[s.miniToggleText, isLimited && s.miniToggleTextActiveLimited]}>
                          Limit
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleUpdateAppState(app.app_id, 'blocked')}
                        style={[s.miniToggle, isBlocked && s.miniToggleActiveBlocked]}
                      >
                        <Ionicons
                          name="close"
                          size={12}
                          color={isBlocked ? '#ff5252' : colors.muted}
                        />
                        <Text style={[s.miniToggleText, isBlocked && s.miniToggleTextActiveBlocked]}>
                          Block
                        </Text>
                      </Pressable>
                    </View>

                    <View style={s.cardFooter}>
                      <Text style={s.updatedText}>
                        Last Updated: {new Date(app.last_updated).toLocaleDateString()}
                      </Text>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {/* TAB 2: METADATA SIGNALS */}
          {activeTab === 'metadata' && (
            <View style={s.section}>
              <View>
                <Text style={ui.eyebrow}>METADATA-LEVEL GATES</Text>
                <Text style={ui.h2}>Signal Minimization Controls</Text>
              </View>

              {/* App Picker Horizontal Chips */}
              <View style={s.appPickerRow}>
                {apps.map(a => (
                  <Pressable
                    key={a.app_id}
                    onPress={() => handleSelectApp(a.app_id)}
                    style={[s.appPickerChip, selectedAppId === a.app_id && s.appPickerChipActive]}
                  >
                    <Text style={[s.appPickerText, selectedAppId === a.app_id && s.appPickerTextActive]}>
                      {a.app_name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {metadataPerms.map(meta => {
                const isAllowed = meta.state === 'allowed';
                const isConditional = meta.state === 'conditional';
                const isBlocked = meta.state === 'blocked';

                return (
                  <Card key={meta.metadata_type}>
                    <View style={ui.row}>
                      <View style={s.flex1}>
                        <Text style={s.metaTypeTitle}>
                          {meta.metadata_type.toUpperCase()}
                        </Text>
                        <Text style={s.metaKeyText}>
                          Target Key: {meta.key || 'All Category Signals'}
                        </Text>
                      </View>

                      <View style={[
                        s.stateBadge,
                        isAllowed && s.stateAllowed,
                        isConditional && s.stateConditional,
                        isBlocked && s.stateBlocked
                      ]}>
                        <Text style={s.stateBadgeText}>{meta.state.toUpperCase()}</Text>
                      </View>
                    </View>

                    {/* Buyer Overrides if present */}
                    {meta.buyer_overrides && meta.buyer_overrides.length > 0 && (
                      <View style={s.overridesBox}>
                        <View style={ui.row}>
                          <Text style={s.overridesLabel}>BUYER OVERRIDES (TAP TO CYCLE)</Text>
                          <Ionicons name="swap-horizontal" size={12} color="#7b6c62" />
                        </View>
                        {meta.buyer_overrides.map((ov, i) => {
                          const isOvAllowed = ov.state === 'allowed';
                          const isOvConditional = ov.state === 'conditional';
                          return (
                            <Pressable
                              key={i}
                              onPress={() =>
                                handleCycleBuyerOverride(
                                  meta.metadata_type,
                                  ov.buyer_category,
                                  ov.state
                                )
                              }
                              style={s.overrideRow}
                            >
                              <Text style={s.overrideBuyer}>{ov.buyer_category}</Text>
                              <View
                                style={[
                                  s.overrideBadge,
                                  isOvAllowed && s.overrideBadgeAllowed,
                                  isOvConditional && s.overrideBadgeConditional,
                                  !isOvAllowed && !isOvConditional && s.overrideBadgeBlocked
                                ]}
                              >
                                <Text
                                  style={[
                                    s.overrideState,
                                    isOvAllowed && s.overrideStateAllowed,
                                    isOvConditional && s.overrideStateConditional,
                                    !isOvAllowed && !isOvConditional && s.overrideStateBlocked
                                  ]}
                                >
                                  {ov.state.toUpperCase()}
                                </Text>
                                <Ionicons
                                  name="refresh"
                                  size={10}
                                  color={
                                    isOvAllowed
                                      ? colors.green
                                      : isOvConditional
                                        ? colors.orange
                                        : '#ff6b6b'
                                  }
                                />
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}

                    {/* Quick State Toggle for Metadata */}
                    <View style={s.stateBtnGroup}>
                      <Pressable
                        onPress={() => handleUpdateMetadataState(meta.metadata_type, 'allowed')}
                        style={[s.miniToggle, isAllowed && s.miniToggleActiveAllowed]}
                      >
                        <Text style={[s.miniToggleText, isAllowed && s.miniToggleTextActiveAllowed]}>
                          Allowed
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleUpdateMetadataState(meta.metadata_type, 'conditional')}
                        style={[s.miniToggle, isConditional && s.miniToggleActiveLimited]}
                      >
                        <Text style={[s.miniToggleText, isConditional && s.miniToggleTextActiveLimited]}>
                          Conditional
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleUpdateMetadataState(meta.metadata_type, 'blocked')}
                        style={[s.miniToggle, isBlocked && s.miniToggleActiveBlocked]}
                      >
                        <Text style={[s.miniToggleText, isBlocked && s.miniToggleTextActiveBlocked]}>
                          Blocked
                        </Text>
                      </Pressable>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          {/* TAB 3: BUYER CATEGORIES */}
          {activeTab === 'buyers' && (
            <View style={s.section}>
              <View>
                <Text style={ui.eyebrow}>BUYER-LEVEL PERMISSIONS</Text>
                <Text style={ui.h2}>Verified Buyer Category Access</Text>
              </View>

              {buyers.map(b => {
                const isAllowed = b.state === 'allowed';
                const isLimited = b.state === 'limited';
                const isBlocked = b.state === 'blocked';

                return (
                  <Card key={b.buyer_category} accent={isAllowed}>
                    <View style={ui.row}>
                      <View style={s.flex1}>
                        <Text style={s.buyerTitle}>{b.buyer_category}</Text>
                        {b.max_value_band !== undefined && (
                          <Text style={s.buyerCap}>
                            Max Value Band: ${b.max_value_band.toFixed(2)} USD
                          </Text>
                        )}
                      </View>

                      <View style={[
                        s.stateBadge,
                        isAllowed && s.stateAllowed,
                        isLimited && s.stateLimited,
                        isBlocked && s.stateBlocked
                      ]}>
                        <Text style={s.stateBadgeText}>{b.state.toUpperCase()}</Text>
                      </View>
                    </View>

                    {/* Buyer State Controls */}
                    <View style={s.stateBtnGroup}>
                      <Pressable
                        onPress={() => handleUpdateBuyerState(b.buyer_category, 'allowed')}
                        style={[s.miniToggle, isAllowed && s.miniToggleActiveAllowed]}
                      >
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color={isAllowed ? '#0c2214' : colors.muted}
                        />
                        <Text style={[s.miniToggleText, isAllowed && s.miniToggleTextActiveAllowed]}>
                          Grant
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleUpdateBuyerState(b.buyer_category, 'limited')}
                        style={[s.miniToggle, isLimited && s.miniToggleActiveLimited]}
                      >
                        <Ionicons
                          name="shield-half"
                          size={12}
                          color={isLimited ? '#ff8c3b' : colors.muted}
                        />
                        <Text style={[s.miniToggleText, isLimited && s.miniToggleTextActiveLimited]}>
                          Limit
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleUpdateBuyerState(b.buyer_category, 'blocked')}
                        style={[s.miniToggle, isBlocked && s.miniToggleActiveBlocked]}
                      >
                        <Ionicons
                          name="close"
                          size={12}
                          color={isBlocked ? '#ff5252' : colors.muted}
                        />
                        <Text style={[s.miniToggleText, isBlocked && s.miniToggleTextActiveBlocked]}>
                          Block
                        </Text>
                      </Pressable>
                    </View>

                    {/* Value Band Adjustment when not blocked */}
                    {!isBlocked && (
                      <View style={s.bandSelectorBox}>
                        <Text style={s.bandSelectorLabel}>MAX VALUE CAP:</Text>
                        <View style={s.bandBtnGroup}>
                          {[2, 5, 10, 25, 50].map(val => {
                            const isCurrent = b.max_value_band === val;
                            return (
                              <Pressable
                                key={val}
                                onPress={() => handleUpdateBuyerBand(b.buyer_category, val)}
                                style={[s.bandBtn, isCurrent && s.bandBtnActive]}
                              >
                                <Text style={[s.bandBtnText, isCurrent && s.bandBtnTextActive]}>
                                  ${val}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </Card>
                );
              })}
            </View>
          )}

          {/* TAB 4: CONSENT LOG */}
          {activeTab === 'audit_log' && (
            <View style={s.section}>
              <View style={ui.row}>
                <View>
                  <Text style={ui.eyebrow}>IMMUTABLE CONSENT AUDIT</Text>
                  <Text style={ui.h2}>Decision History Ledger</Text>
                </View>
                <Text style={s.logCount}>{consentLogs.length} logged</Text>
              </View>

              {consentLogs.map(log => (
                <Card key={log.log_id}>
                  <View style={ui.row}>
                    <View style={s.logBadge}>
                      <Ionicons name="document-text-outline" size={13} color={colors.orange} />
                      <Text style={s.logContext}>{log.context.replace(/_/g, ' ')}</Text>
                    </View>
                    <Text style={s.logTimestamp}>
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>

                  <View style={s.logTransitionRow}>
                    <Text style={s.targetDesc}>
                      {log.app_id || log.buyer_category || log.metadata_type || 'System Policy'}
                    </Text>
                    <View style={s.stateTransition}>
                      <Text style={s.prevState}>{log.previous_state ?? 'null'}</Text>
                      <Ionicons name="arrow-forward" size={12} color={colors.muted} />
                      <Text style={s.newState}>{log.new_state}</Text>
                    </View>
                  </View>

                  <View style={s.logFooter}>
                    <Text style={s.logId}>ID: {log.log_id}</Text>
                    <Text style={s.logDate}>{new Date(log.timestamp).toLocaleDateString()}</Text>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </>
      )}

      {/* Effective Matrix Summary Card */}
      {effective && (
        <Card>
          <Text style={ui.eyebrow}>EFFECTIVE PERMISSIONS SUMMARY</Text>
          <Text style={ui.body}>
            Current user policy grants {effective.apps.filter(a => a.state === 'allowed').length} active app connections,
            evaluates {effective.metadata_permissions.length} signal gate rules, and enforces strict blocks on {effective.buyers.filter(b => b.state === 'blocked').length} buyer categories.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: {
    backgroundColor: '#170c07',
    borderRadius: 20,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#612e12'
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0a1f12',
    borderWidth: 1,
    borderColor: '#18542c',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  statusPillText: {
    color: colors.green,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  heroSub: {
    color: '#b59e92',
    fontSize: 13,
    lineHeight: 18
  },
  divider: {
    height: 1,
    backgroundColor: '#422415',
    marginVertical: 4
  },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: '#0e0804',
    borderWidth: 1,
    borderColor: '#301a0e',
    borderRadius: 12,
    padding: 10
  },
  statItem: {
    flex: 1,
    alignItems: 'center'
  },
  statNum: {
    color: colors.orange,
    fontSize: 20,
    fontWeight: '900'
  },
  statLabel: {
    color: '#806e64',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#301a0e'
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
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10
  },
  tabBtnActive: {
    backgroundColor: '#201209',
    borderWidth: 1,
    borderColor: '#592c13'
  },
  tabBtnText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  tabBtnTextActive: {
    color: colors.orange,
    fontWeight: '800'
  },
  section: {
    gap: 10
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
  flex1: {
    flex: 1
  },
  appName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800'
  },
  appId: {
    color: colors.muted,
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 2
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1
  },
  stateAllowed: {
    backgroundColor: '#0c2214',
    borderColor: '#1d5a32'
  },
  stateLimited: {
    backgroundColor: '#261609',
    borderColor: '#6b3614'
  },
  stateConditional: {
    backgroundColor: '#261609',
    borderColor: '#6b3614'
  },
  stateBlocked: {
    backgroundColor: '#260a0a',
    borderColor: '#691b1b'
  },
  stateBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900'
  },
  reasonText: {
    color: '#a39287',
    fontSize: 12,
    marginTop: 2
  },
  stateBtnGroup: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6
  },
  miniToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#26222b',
    paddingVertical: 8,
    borderRadius: 8
  },
  miniToggleText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700'
  },
  miniToggleActiveAllowed: {
    backgroundColor: colors.green,
    borderColor: colors.green
  },
  miniToggleTextActiveAllowed: {
    color: '#000',
    fontWeight: '900'
  },
  miniToggleActiveLimited: {
    backgroundColor: '#381c0c',
    borderColor: '#7a3b18'
  },
  miniToggleTextActiveLimited: {
    color: colors.orange,
    fontWeight: '900'
  },
  miniToggleActiveBlocked: {
    backgroundColor: '#381010',
    borderColor: '#7a1c1c'
  },
  miniToggleTextActiveBlocked: {
    color: '#ff6b6b',
    fontWeight: '900'
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#242028',
    paddingTop: 6,
    marginTop: 4
  },
  updatedText: {
    color: '#73665e',
    fontSize: 10
  },
  appPickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4
  },
  appPickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#121215',
    borderWidth: 1,
    borderColor: '#27222c'
  },
  appPickerChipActive: {
    backgroundColor: '#261308',
    borderColor: '#6e3514'
  },
  appPickerText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700'
  },
  appPickerTextActive: {
    color: colors.orange,
    fontWeight: '900'
  },
  metaTypeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900'
  },
  metaKeyText: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2
  },
  overridesBox: {
    backgroundColor: '#0d0d10',
    borderWidth: 1,
    borderColor: '#25212a',
    borderRadius: 8,
    padding: 8,
    gap: 4,
    marginTop: 4
  },
  overridesLabel: {
    color: '#7b6c62',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  overrideRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2
  },
  overrideBuyer: {
    color: '#a39287',
    fontSize: 11
  },
  overrideBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1
  },
  overrideBadgeAllowed: {
    backgroundColor: '#0c2214',
    borderColor: '#1d5a32'
  },
  overrideBadgeConditional: {
    backgroundColor: '#261609',
    borderColor: '#6b3614'
  },
  overrideBadgeBlocked: {
    backgroundColor: '#260a0a',
    borderColor: '#691b1b'
  },
  overrideState: {
    fontSize: 9,
    fontWeight: '900'
  },
  overrideStateAllowed: {
    color: colors.green
  },
  overrideStateConditional: {
    color: colors.orange
  },
  overrideStateBlocked: {
    color: '#ff6b6b'
  },
  bandSelectorBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#201b24'
  },
  bandSelectorLabel: {
    color: '#7b6c62',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4
  },
  bandBtnGroup: {
    flexDirection: 'row',
    gap: 6
  },
  bandBtn: {
    flex: 1,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#131317',
    borderWidth: 1,
    borderColor: '#292430',
    borderRadius: 6
  },
  bandBtnActive: {
    backgroundColor: '#2b160b',
    borderColor: colors.orange
  },
  bandBtnText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700'
  },
  bandBtnTextActive: {
    color: colors.orange,
    fontWeight: '900'
  },
  buyerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800'
  },
  buyerCap: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2
  },
  logCount: {
    color: '#7e6f66',
    fontSize: 11,
    fontWeight: '700'
  },
  logBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1b100a',
    borderWidth: 1,
    borderColor: '#422415',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6
  },
  logContext: {
    color: '#ffc8a3',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize'
  },
  logTimestamp: {
    color: '#8c7b72',
    fontSize: 10,
    fontWeight: '600'
  },
  logTransitionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4
  },
  targetDesc: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    flex: 1
  },
  stateTransition: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  prevState: {
    color: colors.muted,
    fontSize: 11,
    textTransform: 'uppercase'
  },
  newState: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase'
  },
  logFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#242028',
    paddingTop: 6,
    marginTop: 4
  },
  logId: {
    color: '#6e625a',
    fontSize: 10,
    fontFamily: 'monospace'
  },
  logDate: {
    color: '#6e625a',
    fontSize: 10
  }
});

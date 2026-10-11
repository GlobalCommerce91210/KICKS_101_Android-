import { useEffect, useState } from 'react';
import { useSession } from './SessionProvider';

export type MonitoringPolicy = { permissionId: string; purpose: string; purposeVersion: string; policyVersion: string };
const empty: MonitoringPolicy = { permissionId: '', purpose: '', purposeVersion: '', policyVersion: '' };
export function useMonitoringPolicy() {
  const { manager, user } = useSession();
  const [resolved, setResolved] = useState<{ subject: string; policy: MonitoringPolicy } | null>(null);
  useEffect(() => {
    let live = true;
    setResolved(null);
    const subject = user?.subjectId;
    if (subject) void manager.request('/core/consumer/v1/monitoring-policy').then(async response => {
      if (!response.ok) return;
      const value = await response.json();
      const p = value.policy;
      if (!p || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.permissionId) ||
          !['purpose', 'purposeVersion', 'policyVersion'].every(k => typeof p[k] === 'string' && p[k].trim())) return;
      if (live && manager.user?.subjectId === subject) setResolved({ subject, policy: {
        permissionId: p.permissionId, purpose: p.purpose, purposeVersion: p.purposeVersion, policyVersion: p.policyVersion,
      } });
    }).catch(() => {});
    return () => { live = false; };
  }, [user?.subjectId]);
  const policy = resolved?.subject === user?.subjectId ? resolved?.policy ?? empty : empty;
  return { policy, configured: Object.values(policy).every(Boolean) };
}

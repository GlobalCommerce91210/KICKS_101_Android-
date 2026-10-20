import { useEffect, useState } from 'react';
import { useSession } from './SessionProvider';
import { emptyMonitoringPolicy, loadMonitoringPolicy, type MonitoringPolicy } from '../services/monitoringPolicy';
export function useMonitoringPolicy() {
  const { manager, user } = useSession();
  const generation = manager.sessionGeneration;
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ generation: number; policy: MonitoringPolicy } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setResolved(null); setError(null);
    if (user) void loadMonitoringPolicy(manager).then(policy => {
      if (live && manager.sessionGeneration === generation) setResolved({ generation, policy });
    }).catch(failure => { if (live) setError(failure instanceof Error ? failure.message : 'Collection setup is unavailable.'); });
    return () => { live = false; };
  }, [user?.subjectId, generation, attempt]);
  const policy = resolved?.generation === generation ? resolved.policy : emptyMonitoringPolicy;
  return { policy, configured: Object.values(policy).every(Boolean), error, retry: () => setAttempt(value => value + 1) };
}

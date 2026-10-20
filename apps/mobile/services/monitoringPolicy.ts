import type { SessionManager } from './sessionCore';
export interface MonitoringPolicy { permissionId: string; purpose: string; purposeVersion: string; policyVersion: string; }
export const emptyMonitoringPolicy: MonitoringPolicy = { permissionId: '', purpose: '', purposeVersion: '', policyVersion: '' };
export async function loadMonitoringPolicy(manager: Pick<SessionManager, 'user' | 'request' | 'sessionGeneration'>): Promise<MonitoringPolicy> {
  const subject = manager.user?.subjectId;
  const generation = manager.sessionGeneration;
  if (!subject) throw new Error('Sign in before reviewing collection setup.');
  const current = () => {
    if (manager.user?.subjectId !== subject || manager.sessionGeneration !== generation) throw new Error('Your session changed. Reload collection setup.');
  };
  const response = await manager.request('/core/consumer/v1/monitoring-policy'); current();
  if (!response.ok) throw new Error('Collection setup is unavailable. Retry when the reviewed monitoring policy and gateway are configured.');
  const value = await response.json(); current();
  const policy = value?.policy;
  if (value?.collectionEnabled !== false || !policy ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(policy.permissionId) ||
      !['purpose', 'purposeVersion', 'policyVersion'].every(key => typeof policy[key] === 'string' &&
        policy[key].trim() && policy[key].length <= (key === 'purpose' ? 120 : 64))) {
    throw new Error('The reviewed collection policy could not be verified. Monitoring remains off.');
  }
  return { permissionId: policy.permissionId, purpose: policy.purpose, purposeVersion: policy.purposeVersion, policyVersion: policy.policyVersion };
}

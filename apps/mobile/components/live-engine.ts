import { NativeModules, Platform } from 'react-native';

export type LiveEngineSnapshotCore = {
  generatedAt: string;
  metrics: {
    observations: number;
    distinctDomains: number;
    review: number;
    attributedApps: number;
  };
  consent: {
    permissionId: string | null;
    purpose: string | null;
    status: 'active' | 'inactive' | 'missing';
    updatedAt: string | null;
  };
  lastObservationAt: string | null;
  observations: unknown[];
};

type SnapshotBridge = {
  getEngineSnapshot(): Promise<string>;
};

const CACHE_WINDOW_MS = 5_000;
let cachedSnapshot: LiveEngineSnapshotCore | null = null;
let cachedAt = 0;
let inFlight: Promise<LiveEngineSnapshotCore> | null = null;

export async function loadLiveEngineSnapshot<T extends LiveEngineSnapshotCore>(options: { force?: boolean } = {}): Promise<T> {
  if (Platform.OS !== 'android') throw new Error('Live Android monitoring is unavailable on this platform.');

  const bridge = NativeModules.KicksVpn as SnapshotBridge | undefined;
  if (!bridge?.getEngineSnapshot) throw new Error('The live Engine bridge is unavailable in this build.');

  const now = Date.now();
  if (!options.force && cachedSnapshot && now - cachedAt < CACHE_WINDOW_MS) return cachedSnapshot as T;
  if (inFlight) return inFlight as Promise<T>;

  inFlight = bridge.getEngineSnapshot()
    .then(parseSnapshot)
    .then(snapshot => {
      cachedSnapshot = snapshot;
      cachedAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight as Promise<T>;
}

function parseSnapshot(value: string): LiveEngineSnapshotCore {
  const parsed = JSON.parse(value) as LiveEngineSnapshotCore;
  if (!parsed || !parsed.metrics || !parsed.consent || !Array.isArray(parsed.observations)) {
    throw new Error('The Engine returned an invalid snapshot.');
  }
  return parsed;
}

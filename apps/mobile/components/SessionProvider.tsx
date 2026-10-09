import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { SessionManager, type AccountUser, type SessionStorage } from '../services/sessionCore';
import { requireIosApiOrigin } from '../services/iosApiOrigin';
const getBaseUrl = () => requireIosApiOrigin(process.env.EXPO_PUBLIC_IOS_API_URL);

const storageKey = 'datastorm.consumer.session.v1';
let webMemory: string | null = null;
const nativeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const storage: SessionStorage = {
  async read() { return Platform.OS === 'web' ? webMemory : SecureStore.getItemAsync(storageKey, nativeOptions); },
  async write(value) { if (Platform.OS === 'web') webMemory = value; else await SecureStore.setItemAsync(storageKey, value, nativeOptions); },
  async clear() { if (Platform.OS === 'web') webMemory = null; else await SecureStore.deleteItemAsync(storageKey, nativeOptions); }
};
interface SessionContextValue {
  manager: SessionManager;
  user: AccountUser | null;
  ready: boolean;
  restoreError: string | null;
  sessionWarning: string | null;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const managerRef = useRef<SessionManager | null>(null);
  if (!managerRef.current) managerRef.current = new SessionManager(storage, getBaseUrl);
  const manager = managerRef.current;
  const restoreFlight = useRef<Promise<void> | null>(null);
  const [user, setUser] = useState(manager.user);
  const [ready, setReady] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [sessionWarning, setSessionWarning] = useState(manager.warning);
  useEffect(() => {
    let live = true;
    const unsubscribe = manager.subscribe(() => { if (live) { setUser(manager.user); setSessionWarning(manager.warning); } });
    if (!restoreFlight.current) restoreFlight.current = manager.restore();
    restoreFlight.current.catch(() => { if (live) setRestoreError('Your previous session could not be restored. Sign in again.'); })
      .finally(() => { if (live) { setUser(manager.user); setReady(true); } });
    return () => { live = false; unsubscribe(); };
  }, [manager]);
  return <SessionContext.Provider value={{ manager, user, ready, restoreError, sessionWarning }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is required.');
  return session;
}

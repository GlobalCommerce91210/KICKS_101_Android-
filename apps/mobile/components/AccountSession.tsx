import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { accountApi, AccountError, clearSession, onSessionExpired, type Session } from '../services/accountApi';

type State = { status: 'restoring' | 'anonymous' | 'authenticated' | 'unavailable'; session: Session | null; error: string | null };
type Context = State & { returnTo: string; rememberRoute(path: string): void; restore(): Promise<void>; login(mode: 'login' | 'create', email: string, password: string): Promise<void>; logout(): Promise<void> };
const SessionContext = createContext<Context | null>(null);
export function AccountSessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<State>({ status: 'restoring', session: null, error: null });
  const generation = useRef(0);
  const restoreAllowed = useRef(true);
  const [returnTo, setReturnTo] = useState('/');
  const rememberRoute = useCallback((path: string) => { if (['/', '/profile', '/permissions', '/wallet', '/opportunities', '/engine', '/settings'].includes(path)) setReturnTo(path); }, []);
  const restore = useCallback(async (explicit = true) => {
    if (!explicit && !restoreAllowed.current) return;
    if (explicit) restoreAllowed.current = true;
    const run = ++generation.current;
    setState({ status: 'restoring', session: null, error: null });
    try { const session = await accountApi.restore(); if (run === generation.current) setState({ status: 'authenticated', session, error: null }); }
    catch (e) { if (run === generation.current) setState({ status: e instanceof AccountError && e.status === 401 ? 'anonymous' : 'unavailable', session: null, error: e instanceof AccountError ? e.code : 'account_service_unavailable' }); }
  }, []);
  useEffect(() => {
    const unsubscribe = onSessionExpired(() => { generation.current++; setState({ status: 'anonymous', session: null, error: 'session_expired' }); });
    void restore(false);
    const subscription = AppState.addEventListener('change', status => { if (status === 'active') void restore(false); });
    return () => { generation.current++; unsubscribe(); subscription.remove(); };
  }, [restore]);
  useEffect(() => {
    if (!state.session) return;
    const remaining = Date.parse(state.session.expires_at) - Date.now();
    const timer = setTimeout(() => {
      if (Date.parse(state.session!.expires_at) > Date.now()) { void restore(); return; }
      generation.current++; setState({ status: 'anonymous', session: null, error: 'session_expired' }); void clearSession();
    }, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [state.session, restore]);
  const login = async (mode: 'login' | 'create', email: string, password: string) => {
    const run = ++generation.current;
    const session = await accountApi.authenticate(mode, email, password);
    restoreAllowed.current = true;
    if (run === generation.current) setState({ status: 'authenticated', session, error: null });
  };
  const logout = async () => {
    generation.current++;
    restoreAllowed.current = false;
    setReturnTo('/');
    try { await accountApi.logout(); setState({ status: 'anonymous', session: null, error: null }); }
    catch { setState({ status: 'anonymous', session: null, error: 'Sign-out could not be confirmed by DataStorm. Retry before using a shared device.' }); }
  };
  return <SessionContext.Provider value={{ ...state, returnTo, rememberRoute, restore, login, logout }}>{children}</SessionContext.Provider>;
}
export function useAccountSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('AccountSessionProvider required');
  return context;
}

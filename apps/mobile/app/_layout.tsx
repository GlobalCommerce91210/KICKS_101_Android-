import { Tabs, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { AccountSessionProvider, useAccountSession } from '../components/AccountSession';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-outline', permissions: 'shield-checkmark-outline', opportunities: 'briefcase-outline',
  wallet: 'wallet-outline', profile: 'person-circle-outline'
};
function AccountTabs() {
  const { status, rememberRoute } = useAccountSession();
  const path = usePathname();
  useEffect(() => { if (status === 'authenticated' || status === 'restoring') rememberRoute(path); }, [path, status, rememberRoute]);
  return <Tabs screenOptions={({ route }) => ({
    headerShown: false,
    tabBarStyle: { backgroundColor: '#0b0b0d', borderTopColor: '#3a2114', height: 66, paddingTop: 5, ...(route.name === 'account' ? { display: 'none' as const } : {}) },
    tabBarActiveTintColor: '#ff6a00', tabBarInactiveTintColor: '#9c8c82',
    tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name] ?? 'ellipse-outline'} color={color} size={size} />
  })}>
    <Tabs.Protected guard={status === 'authenticated'}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="opportunities" options={{ title: 'Opportunities' }} />
      <Tabs.Screen name="permissions" options={{ title: 'Permissions' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="engine" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs.Protected>
    <Tabs.Screen name="account" options={{ href: null }} />
  </Tabs>;
}
export default function Layout() { return <AccountSessionProvider><AccountTabs /></AccountSessionProvider>; }


import { SessionProvider } from '../components/SessionProvider';
import { useSession } from '../components/SessionProvider';
import { ActivityIndicator } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-outline', engine: 'scan-outline', permissions: 'shield-checkmark-outline',
  opportunities: 'briefcase-outline', wallet: 'wallet-outline', settings: 'settings-outline', profile: 'person-circle-outline'
};

export default function Layout() {
  return <SessionProvider><AccountTabs /></SessionProvider>;
}
function AccountTabs() {
  const { user, ready } = useSession();
  if (!ready) return <ActivityIndicator accessibilityLabel="Restoring your DataStorm session" />;
  return (
    <Tabs initialRouteName="account" screenOptions={({ route }) => ({
      headerShown: false,
      tabBarStyle: { backgroundColor: '#0b0b0d', borderTopColor: '#3a2114', height: 66, paddingTop: 5 },
      tabBarActiveTintColor: '#ff6a00', tabBarInactiveTintColor: '#9c8c82',
      tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name] ?? 'ellipse-outline'} color={color} size={size} />
    })}>
      <Tabs.Protected guard={!!user}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="engine" options={{ href: null, title: 'Engine' }} />
      <Tabs.Screen name="permissions" options={{ title: 'Permissions' }} />
      <Tabs.Screen name="opportunities" options={{ title: 'Opportunities' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      </Tabs.Protected>
      <Tabs.Protected guard={!user}>
      <Tabs.Screen name="account" options={{ href: null, title: 'DataStorm account' }} />
      </Tabs.Protected>
    </Tabs>
  );
}



import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { Analytics } from '@vercel/analytics/react';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-outline', engine: 'scan-outline', permissions: 'shield-checkmark-outline',
  opportunities: 'briefcase-outline', wallet: 'wallet-outline', settings: 'settings-outline'
};

export default function Layout() {
  return (
    <>
      <Tabs screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0b0b0d', borderTopColor: '#3a2114', height: 66, paddingTop: 5 },
        tabBarActiveTintColor: '#ff6a00', tabBarInactiveTintColor: '#9c8c82',
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name] ?? 'ellipse-outline'} color={color} size={size} />
      })}>
        <Tabs.Screen name="index" options={{ title: 'Activity' }} />
        <Tabs.Screen name="engine" options={{ title: 'Engine' }} />
        <Tabs.Screen name="permissions" options={{ title: 'Permissions' }} />
        <Tabs.Screen name="opportunities" options={{ title: 'Opportunities' }} />
        <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
      {Platform.OS === 'web' && <Analytics />}
    </>
  );
}

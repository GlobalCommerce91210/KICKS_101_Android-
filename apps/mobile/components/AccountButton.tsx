import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from './Brand';
export function AccountButton({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}><Text style={s.text}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({ button: { backgroundColor: colors.orange, padding: 14, borderRadius: 12, alignItems: 'center', minHeight: 48 }, disabled: { opacity: 0.5 }, text: { color: colors.bg, fontWeight: '800', fontSize: 15 } });

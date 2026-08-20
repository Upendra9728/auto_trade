import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="signal/[id]" />
      <Stack.Screen name="user/[id]" />
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="signal-create" />
      <Stack.Screen name="pnl" />
    </Stack>
  );
}

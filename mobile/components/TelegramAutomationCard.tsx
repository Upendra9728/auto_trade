import React from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, moderateScale } from '../constants/theme';
import { useTelegramAutomation } from './TelegramAutomationToggle';

const TELEGRAM_BLUE = '#0088CC';

export default function TelegramAutomationCard() {
  const { isAdmin, isEnabled, channelName, saving, toggle } = useTelegramAutomation();

  if (!isAdmin) return null;

  return (
    <View style={[styles.card, isEnabled && styles.cardOn]}>
      <View style={[styles.iconWrap, isEnabled ? styles.iconWrapOn : styles.iconWrapOff]}>
        <FontAwesome5 name="telegram-plane" size={20} color={isEnabled ? '#FFFFFF' : Colors.textMuted} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Telegram Automation</Text>
          <View style={[styles.statusPill, isEnabled ? styles.statusPillOn : styles.statusPillOff]}>
            <View style={[styles.dot, isEnabled ? styles.dotOn : styles.dotOff]} />
            <Text style={[styles.statusText, isEnabled ? styles.statusTextOn : styles.statusTextOff]}>
              {isEnabled ? 'ON' : 'OFF'}
            </Text>
          </View>
        </View>
        <Text style={styles.sub} numberOfLines={2}>
          {isEnabled
            ? channelName
              ? `Listening to ${channelName}`
              : 'Listening to any configured channel'
            : 'Incoming Telegram messages are ignored'}
        </Text>
      </View>

      {saving ? (
        <ActivityIndicator size="small" color={TELEGRAM_BLUE} />
      ) : (
        <Switch
          value={isEnabled}
          onValueChange={toggle}
          trackColor={{ false: Colors.border, true: TELEGRAM_BLUE }}
          thumbColor="#FFFFFF"
          accessibilityLabel={`Telegram automation ${isEnabled ? 'on' : 'off'}`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  cardOn: {
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapOn: { backgroundColor: TELEGRAM_BLUE },
  iconWrapOff: { backgroundColor: '#F3F4F6' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: moderateScale(14), fontWeight: '800', color: Colors.text },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  statusPillOn: { backgroundColor: Colors.successBg },
  statusPillOff: { backgroundColor: '#F3F4F6' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { backgroundColor: Colors.success },
  dotOff: { backgroundColor: '#D1D5DB' },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  statusTextOn: { color: Colors.success },
  statusTextOff: { color: Colors.textMuted },
  sub: { fontSize: moderateScale(12), color: Colors.textSecondary },
});

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Radius, moderateScale, Shadow } from '../../constants/theme';

/**
 * NSE market hours: Mon–Fri 09:15 – 15:30 IST
 * (Pre-open 09:00–09:15 is not counted as fully "open" here)
 */
function isMarketOpen(): { open: boolean; timeStr: string } {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5 * 60 + 30;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + istOffset * 60000);

  const day = ist.getDay(); // 0=Sun, 6=Sat
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const totalMins = hours * 60 + minutes;

  const openMins = 9 * 60 + 15;   // 09:15
  const closeMins = 15 * 60 + 30; // 15:30

  const isWeekday = day >= 1 && day <= 5;
  const isInHours = totalMins >= openMins && totalMins < closeMins;

  const h = hours % 12 || 12;
  const m = String(minutes).padStart(2, '0');
  const ampm = hours < 12 ? 'AM' : 'PM';
  const timeStr = `${h}:${m} ${ampm}`;

  return { open: isWeekday && isInHours, timeStr };
}

export default function MarketStatusCard() {
  const [status, setStatus] = useState(isMarketOpen());

  useEffect(() => {
    const id = setInterval(() => setStatus(isMarketOpen()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.8}>
      <View style={styles.row}>
        {/* Pulsing green dot or static grey */}
        <View style={[styles.dot, { backgroundColor: status.open ? '#22C55E' : Colors.textMuted }]} />
        <View style={styles.textGroup}>
          <Text style={[styles.title, { color: status.open ? '#16A34A' : Colors.textSecondary }]}>
            {status.open ? 'Market Open' : 'Market Closed'}
          </Text>
          <Text style={styles.sub}>NSE &amp; BSE Live</Text>
        </View>
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{status.timeStr}</Text>
        <Feather name="chevron-right" size={14} color={Colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  textGroup: {
    gap: 2,
  },
  title: {
    fontSize: moderateScale(13),
    fontWeight: '700',
  },
  sub: {
    fontSize: moderateScale(10),
    color: Colors.textMuted,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  timeText: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    fontWeight: '600',
  },
});

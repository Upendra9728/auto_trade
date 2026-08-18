import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, moderateScale } from '../constants/theme';
import type { LiveOrderStatus } from '../types';

const CONFIG: Record<LiveOrderStatus, { label: string; bg: string; color: string }> = {
  TRANSIT:   { label: 'Live: In Transit', bg: Colors.infoBg,    color: Colors.info },
  PENDING:   { label: 'Live: Pending',    bg: Colors.warningBg, color: Colors.warning },
  TRADED:    { label: 'Live: Traded',     bg: Colors.successBg, color: Colors.success },
  REJECTED:  { label: 'Live: Rejected',   bg: Colors.errorBg,   color: Colors.error },
  CANCELLED: { label: 'Live: Cancelled',  bg: '#F3F4F6',        color: '#6B7280' },
  EXPIRED:   { label: 'Live: Expired',    bg: '#F3F4F6',        color: '#6B7280' },
};

interface Props {
  liveStatus: LiveOrderStatus | null | undefined;
  size?: 'sm' | 'md';
}

/**
 * Shows the real-time exchange status of an order, sourced from Dhan's Live
 * Order Update WebSocket. Renders nothing until the first live update arrives
 * (i.e. the HTTP placement call was accepted but the exchange hasn't confirmed yet).
 */
export default function LiveStatusBadge({ liveStatus, size = 'md' }: Props) {
  if (!liveStatus) {
    const isSmall = size === 'sm';
    return (
      <View style={[styles.badge, { backgroundColor: '#F3F4F6' }, isSmall && styles.badgeSm]}>
        <Text style={[styles.text, { color: '#6B7280' }, isSmall && styles.textSm]}>
          Awaiting exchange confirmation
        </Text>
      </View>
    );
  }

  const cfg = CONFIG[liveStatus];
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }, isSmall && styles.badgeSm]}>
      <Text style={[styles.text, { color: cfg.color }, isSmall && styles.textSm]}>
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  badgeSm: { paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: moderateScale(12), fontWeight: '600' },
  textSm: { fontSize: moderateScale(11) },
});

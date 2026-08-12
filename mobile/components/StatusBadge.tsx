import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius } from '../constants/theme';

type StatusType = 'pending' | 'confirmed' | 'rejected' | 'placed' | 'failed' | 'active' | 'cancelled' | 'expired';

const CONFIG: Record<StatusType, { label: string; bg: string; color: string }> = {
  pending:   { label: 'Pending',    bg: Colors.warningBg,  color: Colors.warning },
  confirmed: { label: 'Confirmed',  bg: Colors.infoBg,     color: Colors.info },
  placed:    { label: 'Submitted',  bg: Colors.successBg,  color: Colors.success },
  failed:    { label: 'Failed',     bg: Colors.errorBg,    color: Colors.error },
  rejected:  { label: 'Rejected',   bg: '#F3F4F6',         color: '#6B7280' },
  active:    { label: 'Active',     bg: Colors.primaryBg,  color: Colors.primary },
  cancelled: { label: 'Cancelled',  bg: '#F3F4F6',         color: '#6B7280' },
  expired:   { label: 'Expired Unfilled', bg: Colors.warningBg, color: Colors.warning },
};

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const cfg = CONFIG[status as StatusType] ?? { label: status, bg: '#F3F4F6', color: '#6B7280' };
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
  text: { fontSize: 12, fontWeight: '600' },
  textSm: { fontSize: 11 },
});

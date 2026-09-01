import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography, moderateScale } from '../constants/theme';
import { formatDateIST } from '../utils/time';
import type { OrderEvent } from '../types';

interface Props {
  events: OrderEvent[];
  loading?: boolean;
}

// Render only the most recent events by default — the backend already caps and
// dedupes the history, but this keeps the timeline light even at that cap.
const INITIAL_VISIBLE = 25;

const EVENT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: keyof typeof Feather.glyphMap }> = {
  ENTRY_TRADED:   { label: 'Entry Filled',     color: '#2563EB', bg: '#EFF6FF', icon: 'check-circle' },
  TARGET_HIT:     { label: 'Target Hit (Exit)',color: '#059669', bg: '#ECFDF5', icon: 'trending-up' },
  STOP_LOSS_HIT:  { label: 'Stop Loss Hit (Exit)', color: '#DC2626', bg: '#FEF2F2', icon: 'trending-down' },
  CLOSED:         { label: 'Position Closed',  color: '#7C3AED', bg: '#F5F3FF', icon: 'lock' },
  REJECTED:       { label: 'Order Rejected',   color: '#DC2626', bg: '#FEF2F2', icon: 'x-circle' },
  CANCELLED:      { label: 'Order Cancelled',  color: '#6B7280', bg: '#F3F4F6', icon: 'slash' },
  EXPIRED:        { label: 'Order Expired',    color: '#6B7280', bg: '#F3F4F6', icon: 'clock' },
  ENTRY_PENDING:  { label: 'Order Pending',    color: '#D97706', bg: '#FFFBEB', icon: 'loader' },
};

export default function OrderTimeline({ events, loading = false }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading live events...</Text>
      </View>
    );
  }

  if (!events || events.length === 0) {
    return (
      <View style={styles.empty}>
        <Feather name="activity" size={24} color={Colors.textMuted} />
        <Text style={styles.emptyText}>No events recorded yet. Updates will appear in real-time.</Text>
      </View>
    );
  }

  const hiddenCount = events.length - INITIAL_VISIBLE;
  const visibleEvents = showAll || hiddenCount <= 0 ? events : events.slice(hiddenCount);

  return (
    <View style={styles.container}>
      {hiddenCount > 0 && !showAll && (
        <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAll(true)}>
          <Text style={styles.showMoreText}>Show {hiddenCount} earlier event{hiddenCount > 1 ? 's' : ''}</Text>
        </TouchableOpacity>
      )}
      {visibleEvents.map((ev, index) => {
        const isLast = index === visibleEvents.length - 1;
        const cfg = EVENT_CONFIG[ev.event_type] || {
          label: ev.event_type || 'Update',
          color: Colors.textSecondary,
          bg: '#F3F4F6',
          icon: 'info',
        };

        return (
          <View key={ev.id || index} style={styles.timelineRow}>
            {/* Left node & connector */}
            <View style={styles.nodeColumn}>
              <View style={[styles.iconCircle, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
                <Feather name={cfg.icon} size={14} color={cfg.color} />
              </View>
              {!isLast && <View style={styles.connector} />}
            </View>

            {/* Right details */}
            <View style={[styles.contentCard, isLast && { marginBottom: 0 }]}>
              <View style={styles.headerRow}>
                <Text style={[styles.eventTitle, { color: cfg.color }]} numberOfLines={1}>{cfg.label}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{ev.source.toUpperCase()}</Text>
                </View>
              </View>

              <Text style={styles.timestamp}>{formatDateIST(ev.created_at)}</Text>

              {(ev.price != null || ev.quantity != null || ev.leg != null) && (
                <View style={styles.metaRow}>
                  {ev.price != null && (
                    <Text style={styles.metaText}>
                      Price: <Text style={styles.metaBold}>₹{ev.price.toFixed(2)}</Text>
                    </Text>
                  )}
                  {ev.quantity != null && (
                    <Text style={styles.metaText}>
                      Qty: <Text style={styles.metaBold}>{ev.quantity}</Text>
                    </Text>
                  )}
                  {ev.leg && (
                    <Text style={styles.metaText}>
                      Leg: <Text style={styles.metaBold}>{ev.leg}</Text>
                    </Text>
                  )}
                </View>
              )}

              {ev.reason_description && (
                <Text style={styles.reasonText}>{ev.reason_description}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: Spacing.sm },
  center: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  loadingText: { ...Typography.caption, color: Colors.textSecondary },
  empty: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs },
  emptyText: { ...Typography.bodySmall, color: Colors.textMuted, textAlign: 'center' },
  showMoreBtn: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryBg,
    marginBottom: Spacing.sm,
  },
  showMoreText: { ...Typography.caption, color: Colors.primary, fontWeight: '700' },

  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  nodeColumn: {
    alignItems: 'center',
    width: 32,
  },
  iconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 36,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  contentCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    marginLeft: Spacing.sm,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  eventTitle: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    flex: 1,
  },
  badge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: moderateScale(10),
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  timestamp: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.sm,
    rowGap: Spacing.xs,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  metaText: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
  },
  metaBold: {
    fontWeight: '700',
    color: Colors.text,
  },
  reasonText: {
    fontSize: moderateScale(12),
    color: Colors.error,
    marginTop: 4,
  },
});

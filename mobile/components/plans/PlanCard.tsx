import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, moderateScale } from '../../constants/theme';
import type { CreditPlan } from '../../types';

interface PlanCardProps {
  plan: CreditPlan;
  onBuy: (plan: CreditPlan) => void;
  loading?: boolean;
  /** Highlight this card as selected */
  selected?: boolean;
}

// Plan-specific colour scheme
const PLAN_THEME: Record<string, { accent: string; accentLight: string; gradStart: string }> = {
  basic: {
    accent: '#3B82F6',
    accentLight: '#EFF6FF',
    gradStart: '#1E40AF',
  },
  intermediate: {
    accent: '#7C3AED',
    accentLight: '#F5F3FF',
    gradStart: '#5B21B6',
  },
  pro: {
    accent: '#D97706',
    accentLight: '#FFFBEB',
    gradStart: '#92400E',
  },
};

export default function PlanCard({ plan, onBuy, loading = false, selected = false }: PlanCardProps) {
  const theme = PLAN_THEME[plan.id] ?? PLAN_THEME.basic;
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
  };

  return (
    <Animated.View
      style={[
        styles.cardWrapper,
        selected && { borderColor: theme.accent, borderWidth: 2 },
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      {/* ── Badge ── */}
      {plan.badge && (
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <Feather name="star" size={10} color="#fff" style={{ marginRight: 3 }} />
          <Text style={styles.badgeText}>{plan.badge}</Text>
        </View>
      )}

      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: theme.gradStart }]}>
        <Text style={styles.planName}>{plan.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.currency}>₹</Text>
          <Text style={styles.price}>{plan.amount_rs.toLocaleString('en-IN')}</Text>
        </View>
        {plan.description ? (
          <Text style={styles.headerDesc}>{plan.description}</Text>
        ) : null}
      </View>

      {/* ── Credit Breakdown ── */}
      <View style={[styles.body, { backgroundColor: theme.accentLight }]}>
        {/* Base credits */}
        <View style={styles.creditRow}>
          <View style={[styles.creditDot, { backgroundColor: theme.accent }]} />
          <Text style={styles.creditLabel}>{plan.paid_credits} Credits</Text>
          <Text style={styles.creditValue}>₹{(plan.base_amount_rs ?? plan.amount_rs).toLocaleString('en-IN')}</Text>
        </View>

        {/* GST */}
        {plan.gst_amount_rs ? (
          <View style={styles.creditRow}>
            <View style={[styles.creditDot, { backgroundColor: Colors.textMuted }]} />
            <Text style={[styles.creditLabel, { color: Colors.textSecondary }]}>GST ({plan.gst_percent ?? 18}%)</Text>
            <Text style={[styles.creditValue, { color: Colors.textSecondary }]}>₹{plan.gst_amount_rs.toLocaleString('en-IN')}</Text>
          </View>
        ) : null}

        {/* Bonus credits */}
        {plan.bonus_credits > 0 && (
          <View style={styles.creditRow}>
            <View style={[styles.creditDot, { backgroundColor: '#059669' }]} />
            <Text style={[styles.creditLabel, { color: '#059669' }]}>
              +{plan.bonus_credits} Bonus Credits
            </Text>
            <View style={styles.freeBadge}>
              <Text style={styles.freeText}>FREE</Text>
            </View>
          </View>
        )}

        {/* Divider + Total */}
        <View style={styles.divider} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Credits</Text>
          <View style={[styles.totalBadge, { backgroundColor: theme.accent }]}>
            <Text style={styles.totalValue}>{plan.total_credits}</Text>
          </View>
        </View>

        {/* Per-credit price */}
        <Text style={styles.perCredit}>
          ₹{Math.round(plan.amount_rs / plan.total_credits).toLocaleString('en-IN')} per credit
          {plan.bonus_credits > 0 ? ' (incl. bonus)' : ''}
        </Text>
      </View>

      {/* ── Buy Button ── */}
      <TouchableOpacity
        style={[styles.buyBtn, { backgroundColor: theme.accent }, loading && styles.buyBtnDisabled]}
        onPress={() => onBuy(plan)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <Text style={styles.buyBtnText}>Processing…</Text>
        ) : (
          <>
            <Feather name="zap" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.buyBtnText}>Buy {plan.total_credits} Credits — ₹{plan.amount_rs.toLocaleString('en-IN')}</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    borderRadius: Radius.lg,
    overflow: 'visible',
    backgroundColor: Colors.surface,
    ...Shadow.card,
    elevation: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  badge: {
    position: 'absolute',
    top: -12,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    zIndex: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  header: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.md,
    paddingTop: Spacing.lg,
  },
  planName: {
    color: '#fff',
    fontSize: moderateScale(20),
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  currency: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: moderateScale(18),
    fontWeight: '600',
    marginTop: 4,
    marginRight: 1,
  },
  price: {
    color: '#fff',
    fontSize: moderateScale(38),
    fontWeight: '900',
    lineHeight: moderateScale(44),
  },
  headerDesc: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: moderateScale(12),
    fontStyle: 'italic',
  },
  body: {
    padding: Spacing.md,
    gap: 10,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  creditDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  creditLabel: {
    flex: 1,
    fontSize: moderateScale(14),
    fontWeight: '600',
    color: Colors.text,
  },
  creditValue: {
    fontSize: moderateScale(13),
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  freeBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#059669',
  },
  freeText: {
    color: '#059669',
    fontSize: moderateScale(10),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: 4,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: {
    fontSize: moderateScale(15),
    fontWeight: '700',
    color: Colors.text,
  },
  totalBadge: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  totalValue: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '800',
  },
  perCredit: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    textAlign: 'right',
    fontStyle: 'italic',
  },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: Spacing.md,
    marginTop: 0,
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  buyBtnDisabled: {
    opacity: 0.6,
  },
  buyBtnText: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  gstNote: {
    textAlign: 'center',
    fontSize: moderateScale(10),
    color: Colors.textMuted,
    marginTop: -8,
    marginBottom: Spacing.md,
    fontStyle: 'italic',
  }
});


import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Spacing, Radius, moderateScale, Shadow } from '../../constants/theme';
import { userApi } from '../../services/api';
import type { SignalNotification } from '../../types';
import { formatDateTimeIST, toUTCDate } from '../../utils/time';
import SignalPriceBar from '../SignalPriceBar';
import { useLiveLtp } from '../../hooks/useLiveLtp';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TABS = ['Live Signals', 'My Trades', 'Performance', 'Learning'] as const;
type Tab = typeof TABS[number];

const LIVE_SIGNAL_TTL_SECONDS = 60; // 60 seconds
const SIGNAL_POLL_INTERVAL = 5000;  // 5 seconds

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatCountdown(remainingSeconds: number): string {
  const m = Math.floor(remainingSeconds / 60);
  const s = Math.max(0, remainingSeconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function TabBar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  return (
    <View style={tabStyles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tabStyles.scrollContent}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[tabStyles.tab, active === tab && tabStyles.tabActive]}
            onPress={() => onSelect(tab)}
            activeOpacity={0.7}
          >
            <Text style={[tabStyles.label, active === tab && tabStyles.labelActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    gap: 0,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
    marginRight: 4,
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  label: {
    fontSize: moderateScale(12),
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
});

// ── Live Signal Card ──────────────────────────────────────────

function LiveSignalCard({
  notification,
  remainingSeconds,
  livePrice,
}: {
  notification: SignalNotification;
  remainingSeconds: number;
  livePrice?: number | null;
}) {
  const sig = notification.signal;
  const isBuy = sig.transaction_type === 'BUY';
  const isUrgent = remainingSeconds <= 15;

  const expiryDate = sig.expires_at
    ? new Date(sig.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <TouchableOpacity
      style={lsStyles.card}
      onPress={() => router.push('/(user)/signals')}
      activeOpacity={0.88}
    >
      {/* Header */}
      <View style={lsStyles.cardHeader}>
        <View style={lsStyles.liveBadge}>
          <View style={lsStyles.liveDot} />
          <Text style={lsStyles.liveText}>LIVE SIGNAL</Text>
        </View>
        <View style={[lsStyles.timerBadge, isUrgent && lsStyles.timerBadgeUrgent]}>
          <Ionicons
            name="time-outline"
            size={13}
            color={isUrgent ? Colors.error : Colors.warning}
          />
          <Text style={[lsStyles.timerText, isUrgent && lsStyles.timerTextUrgent]}>
            Valid for {formatCountdown(remainingSeconds)}
          </Text>
        </View>
      </View>

      {/* Title + badges */}
      <Text style={lsStyles.signalTitle} numberOfLines={2}>
        {sig.title}
      </Text>
      <View style={lsStyles.badgeRow}>
        <View style={[lsStyles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
          <Text style={[lsStyles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
            {sig.transaction_type}
          </Text>
        </View>
        <View style={lsStyles.tagBadge}>
          <Text style={lsStyles.tagText}>{sig.product_type}</Text>
        </View>
        <View style={lsStyles.tagBadge}>
          <Text style={lsStyles.tagText}>{sig.exchange_segment.replace('_', ' ')}</Text>
        </View>
        {sig.lot_size ? (
          <View style={lsStyles.tagBadge}>
            <Text style={lsStyles.tagText}>Lot: {sig.lot_size}</Text>
          </View>
        ) : null}
      </View>

      {/* Graphical Price Bar with live pointer */}
      <SignalPriceBar
        entryPrice={sig.price}
        targetPrice={sig.target_price}
        stopLossPrice={sig.stop_loss_price}
        transactionType={sig.transaction_type}
        currentPrice={livePrice}
        exitPrice={notification.exit_price}
        exitLeg={notification.exit_leg}
        variant="compact"
      />

      {/* Expiry */}
      {expiryDate && (
        <View style={lsStyles.infoRow}>
          <Feather name="calendar" size={12} color={Colors.textMuted} />
          <Text style={lsStyles.infoLabel}>Expiry:</Text>
          <Text style={lsStyles.infoValue}>{expiryDate}</Text>
        </View>
      )}

      {/* Tap to trade banner */}
      <View style={lsStyles.actionBanner}>
        <View style={lsStyles.actionLeft}>
          <Ionicons name="flash" size={14} color={Colors.primary} />
          <Text style={lsStyles.actionText}>Tap to view and place order</Text>
        </View>
        <Feather name="arrow-right" size={14} color={Colors.primary} />
      </View>

      <Text style={lsStyles.disclaimer}>Tap anywhere on this card to act in Signals tab</Text>
    </TouchableOpacity>
  );
}

const lsStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.successBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.success,
  },
  liveText: {
    fontSize: moderateScale(11),
    fontWeight: '800',
    color: Colors.success,
    letterSpacing: 0.5,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.warningBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  timerBadgeUrgent: {
    backgroundColor: Colors.errorBg,
    borderColor: '#FECACA',
  },
  timerText: {
    fontSize: moderateScale(11),
    color: Colors.warning,
    fontWeight: '700',
  },
  timerTextUrgent: {
    color: Colors.error,
  },
  signalTitle: {
    fontSize: moderateScale(18),
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  txBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  txText: {
    fontSize: moderateScale(12),
    fontWeight: '800',
  },
  tagBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  priceGrid: {
    flexDirection: 'row',
    gap: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  priceCell: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  priceCellLabel: {
    fontSize: moderateScale(10),
    color: Colors.textMuted,
    fontWeight: '600',
  },
  priceCellValue: {
    fontSize: moderateScale(14),
    fontWeight: '800',
    color: Colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoLabel: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: moderateScale(12),
    color: Colors.text,
    fontWeight: '700',
  },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primaryBg,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 2,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: Colors.primary,
  },
  disclaimer: {
    fontSize: moderateScale(10),
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
});

// ── No Live Signal ────────────────────────────────────────────

function NoLiveSignal() {
  return (
    <View style={emptyStyles.container}>
      <View style={emptyStyles.iconCircle}>
        <MaterialCommunityIcons name="signal-variant" size={30} color={Colors.textMuted} />
      </View>
      <Text style={emptyStyles.title}>No Live Signals Right Now</Text>
      <Text style={emptyStyles.sub}>
        Signals broadcast in the last 60 seconds appear here in real-time.
      </Text>
      <TouchableOpacity
        style={emptyStyles.btn}
        onPress={() => router.push('/(user)/signals')}
        activeOpacity={0.8}
      >
        <Feather name="radio" size={14} color={Colors.primary} />
        <Text style={emptyStyles.btnText}>View All Signals</Text>
      </TouchableOpacity>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: Spacing.sm,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: moderateScale(15),
    fontWeight: '700',
    color: Colors.text,
  },
  sub: {
    fontSize: moderateScale(12),
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: 270,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryBg,
  },
  btnText: {
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: Colors.primary,
  },
});

// ── My Trades Panel ───────────────────────────────────────────

function MyTradesPanel() {
  const [orders, setOrders] = useState<SignalNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    userApi.getOrders({ pageSize: 5 })
      .then(res => setOrders(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={tradeStyles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!orders.length) {
    return (
      <View style={emptyStyles.container}>
        <View style={emptyStyles.iconCircle}>
          <Feather name="shopping-bag" size={28} color={Colors.textMuted} />
        </View>
        <Text style={emptyStyles.title}>No Trades Yet</Text>
        <Text style={emptyStyles.sub}>Confirmed orders and executions will show here.</Text>
        <TouchableOpacity
          style={emptyStyles.btn}
          onPress={() => router.push('/(user)/orders')}
          activeOpacity={0.8}
        >
          <Feather name="list" size={14} color={Colors.primary} />
          <Text style={emptyStyles.btnText}>View Order History</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={tradeStyles.list}>
      {orders.map(o => {
        const isBuy = o.signal.transaction_type === 'BUY';
        const pnl = o.realized_pnl;
        return (
          <TouchableOpacity
            key={o.id}
            style={tradeStyles.card}
            onPress={() => router.push('/(user)/orders')}
            activeOpacity={0.85}
          >
            {/* Top row: Badges + Title on left, P&L badge on right (fixed) */}
            <View style={tradeStyles.row}>
              <View style={tradeStyles.titleLeft}>
                <View style={[tradeStyles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
                  <Text style={[tradeStyles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
                    {o.signal.transaction_type}
                  </Text>
                </View>
                <Text style={tradeStyles.title} numberOfLines={1} ellipsizeMode="tail">
                  {o.signal.title}
                </Text>
              </View>
              {pnl != null && (
                <View style={[tradeStyles.pnlBadge, { backgroundColor: pnl >= 0 ? Colors.successBg : Colors.errorBg }]}>
                  <Text style={[tradeStyles.pnlText, { color: pnl >= 0 ? Colors.success : Colors.error }]}>
                    {pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`}
                  </Text>
                </View>
              )}
            </View>

            {/* Meta row */}
            <View style={tradeStyles.meta}>
              <Text style={tradeStyles.metaText}>{o.signal.exchange_segment}</Text>
              <Text style={tradeStyles.metaDot}>·</Text>
              <Text style={tradeStyles.metaText}>Entry ₹{o.signal.price}</Text>
              {o.traded_price != null && (
                <>
                  <Text style={tradeStyles.metaDot}>·</Text>
                  <Text style={tradeStyles.metaText}>Filled ₹{o.traded_price.toFixed(2)}</Text>
                </>
              )}
              <Text style={tradeStyles.metaDot}>·</Text>
              <Text style={tradeStyles.metaText}>{formatDateTimeIST(o.created_at)}</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        style={tradeStyles.viewAllBtn}
        onPress={() => router.push('/(user)/orders')}
        activeOpacity={0.8}
      >
        <Text style={tradeStyles.viewAllText}>View All Orders & Trades</Text>
        <Feather name="chevron-right" size={14} color={Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const tradeStyles = StyleSheet.create({
  center: { padding: 40, alignItems: 'center' },
  list: { gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
    ...Shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  txBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    flexShrink: 0,
  },
  txText: { fontSize: 11, fontWeight: '800' },
  title: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  pnlBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    flexShrink: 0,
  },
  pnlText: {
    fontSize: moderateScale(12),
    fontWeight: '800',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  metaDot: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
  },
  metaText: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    marginTop: 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryBg,
  },
  viewAllText: {
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: Colors.primary,
  },
});

// ── Coming Soon ───────────────────────────────────────────────

function ComingSoon({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={csStyles.container}>
      <View style={csStyles.iconWrap}>
        <Ionicons name={icon as any} size={36} color={Colors.primary} />
      </View>
      <Text style={csStyles.title}>{label}</Text>
      <Text style={csStyles.sub}>We're working on this. Check back soon! 🚀</Text>
      <View style={csStyles.badge}>
        <Text style={csStyles.badgeText}>Coming Soon</Text>
      </View>
    </View>
  );
}

const csStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 44,
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: moderateScale(16),
    fontWeight: '800',
    color: Colors.text,
  },
  sub: {
    fontSize: moderateScale(12),
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
  badge: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.primaryBg,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  badgeText: {
    fontSize: moderateScale(11),
    fontWeight: '700',
    color: Colors.primary,
  },
});

// ─────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────

export default function HomeTabsSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Live Signals');

  // Notifications pool
  const [notifications, setNotifications] = useState<SignalNotification[]>([]);
  const [signalLoading, setSignalLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const fetchSignals = useCallback(async () => {
    try {
      const res = await userApi.getNotifications({ page: 1, pageSize: 5 });
      setNotifications(res.items);
    } catch {
      // keep existing
    } finally {
      setSignalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    const poll = setInterval(fetchSignals, SIGNAL_POLL_INTERVAL);
    const ticker = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(poll);
      clearInterval(ticker);
    };
  }, [fetchSignals]);

  // Filter signals created within the last LIVE_SIGNAL_TTL_SECONDS
  const liveSignals = notifications
    .filter((n) => {
      if (n.status === 'rejected' || n.signal.status === 'cancelled') return false;
      const createdMs = toUTCDate(n.created_at).getTime();
      const ageSeconds = Math.floor((now - createdMs) / 1000);
      return ageSeconds >= 0 && ageSeconds < LIVE_SIGNAL_TTL_SECONDS;
    })
    .sort((a, b) => toUTCDate(b.created_at).getTime() - toUTCDate(a.created_at).getTime());

  const instruments = liveSignals.map((n) => ({
    segment: n.signal.exchange_segment,
    security_id: n.signal.security_id,
  }));
  const { getLtp } = useLiveLtp(instruments);

  return (
    <View style={styles.container}>
      <TabBar active={activeTab} onSelect={setActiveTab} />

      <View style={styles.content}>
        {activeTab === 'Live Signals' && (
          signalLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : liveSignals.length > 0 ? (
            <View style={{ gap: Spacing.md }}>
              {liveSignals.map((n) => {
                const ageSeconds = Math.floor((now - toUTCDate(n.created_at).getTime()) / 1000);
                const remaining = Math.max(0, LIVE_SIGNAL_TTL_SECONDS - ageSeconds);
                return (
                  <LiveSignalCard
                    key={n.id}
                    notification={n}
                    remainingSeconds={remaining}
                    livePrice={getLtp(n.signal.exchange_segment, n.signal.security_id)}
                  />
                );
              })}
            </View>
          ) : (
            <NoLiveSignal />
          )
        )}

        {activeTab === 'My Trades' && <MyTradesPanel />}

        {activeTab === 'Performance' && (
          <ComingSoon icon="bar-chart-outline" label="Performance Analytics" />
        )}

        {activeTab === 'Learning' && (
          <ComingSoon icon="book-outline" label="Learning Hub" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  content: {
    padding: Spacing.md,
    minHeight: 260,
  },
});

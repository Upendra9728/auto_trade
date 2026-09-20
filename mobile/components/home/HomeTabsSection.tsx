import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Animated,
} from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, moderateScale, Shadow } from '../../constants/theme';
import { userApi } from '../../services/api';
import type { SignalNotification } from '../../types';
import { formatDateTimeIST } from '../../utils/time';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TABS = ['Live Signals', 'My Trades', 'Performance', 'Learning'] as const;
type Tab = typeof TABS[number];

const LIVE_SIGNAL_TTL_SECONDS = 60; // 1 minute
const SIGNAL_POLL_INTERVAL = 5000;  // 5 seconds

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function getSignalAge(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  return Math.floor((now - created) / 1000);
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
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
      {/* Active underline */}
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
    paddingVertical: 12,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
    marginRight: 4,
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  label: {
    fontSize: moderateScale(14),
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
});

// ── Live Signal Card ──────────────────────────────────────────

function LiveSignalCard({ notification, countdown }: { notification: SignalNotification; countdown: number }) {
  const sig = notification.signal;
  const isBuy = sig.transaction_type === 'BUY';

  const expiryDate = sig.expires_at
    ? new Date(sig.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <View style={lsStyles.card}>
      {/* Header */}
      <View style={lsStyles.cardHeader}>
        <View style={lsStyles.newSignalRow}>
          <Ionicons name="megaphone" size={16} color={Colors.primary} />
          <Text style={lsStyles.newSignalText}>New Signal</Text>
        </View>
        <View style={lsStyles.timerRow}>
          <Ionicons name="time-outline" size={14} color={Colors.warning} />
          <Text style={lsStyles.timerText}>
            Valid for {formatCountdown(Math.max(0, LIVE_SIGNAL_TTL_SECONDS - countdown))}
          </Text>
        </View>
      </View>

      {/* Title + badges */}
      <Text style={lsStyles.signalTitle}>{sig.title}</Text>
      <View style={lsStyles.badgeRow}>
        <View style={[lsStyles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
          <Text style={[lsStyles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
            {sig.transaction_type}
          </Text>
        </View>
        <View style={lsStyles.tagBadge}><Text style={lsStyles.tagText}>{sig.product_type}</Text></View>
        <View style={lsStyles.tagBadge}><Text style={lsStyles.tagText}>{sig.exchange_segment.replace('_', ' ')}</Text></View>
      </View>

      {/* Price grid */}
      <View style={lsStyles.priceGrid}>
        <View style={lsStyles.priceCell}>
          <Text style={lsStyles.priceCellLabel}>Entry Zone</Text>
          <Text style={lsStyles.priceCellValue}>₹{sig.price}</Text>
        </View>
        <View style={[lsStyles.priceCell, lsStyles.priceCellHighlight]}>
          <Text style={[lsStyles.priceCellLabel, { color: Colors.error }]}>Stop Loss</Text>
          <Text style={[lsStyles.priceCellValue, { color: Colors.error, fontSize: moderateScale(18) }]}>
            ₹{sig.stop_loss_price}
          </Text>
        </View>
        <View style={lsStyles.priceCell}>
          <Text style={[lsStyles.priceCellLabel, { color: Colors.success }]}>Target 1</Text>
          <Text style={[lsStyles.priceCellValue, { color: Colors.success }]}>₹{sig.target_price}</Text>
        </View>
      </View>

      {/* Expiry */}
      {expiryDate && (
        <View style={lsStyles.infoRow}>
          <Feather name="calendar" size={13} color={Colors.textMuted} />
          <Text style={lsStyles.infoLabel}>Expiry</Text>
          <Text style={lsStyles.infoValue}>{expiryDate}</Text>
        </View>
      )}

      {/* Trade setup note */}
      <View style={lsStyles.infoRow}>
        <Feather name="file-text" size={13} color={Colors.textMuted} />
        <Text style={lsStyles.infoLabel}>Trade Setup Note</Text>
      </View>
      <Text style={lsStyles.noteText}>Follow the entry zone and manage risk as per plan.</Text>

      {/* New Signal badge on right */}
      <View style={lsStyles.newSignalBadge}>
        <Ionicons name="bar-chart" size={22} color={Colors.success} />
        <Text style={lsStyles.newSignalBadgeTitle}>New Signal</Text>
        <Text style={lsStyles.newSignalBadgeSub}>Be the first to act</Text>
      </View>

      {/* Disclaimer */}
      <Text style={lsStyles.disclaimer}>This is an educational view. We don't provide any profit guarantee.</Text>
    </View>
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
    position: 'relative',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  newSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  newSignalText: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: Colors.primary,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timerText: {
    fontSize: moderateScale(12),
    color: Colors.warning,
    fontWeight: '700',
  },
  signalTitle: {
    fontSize: moderateScale(22),
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  txBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  txText: {
    fontSize: moderateScale(13),
    fontWeight: '800',
  },
  tagBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagText: {
    fontSize: moderateScale(12),
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  priceGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  priceCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  priceCellHighlight: {},
  priceCellLabel: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    fontWeight: '600',
  },
  priceCellValue: {
    fontSize: moderateScale(16),
    fontWeight: '800',
    color: Colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoLabel: {
    fontSize: moderateScale(12),
    color: Colors.textMuted,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: moderateScale(13),
    color: Colors.text,
    fontWeight: '700',
  },
  noteText: {
    fontSize: moderateScale(12),
    color: Colors.textMuted,
    marginLeft: 19,
    marginTop: -4,
  },
  newSignalBadge: {
    position: 'absolute',
    right: Spacing.md,
    top: 90,
    alignItems: 'center',
    backgroundColor: Colors.successBg,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    gap: 2,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  newSignalBadgeTitle: {
    fontSize: moderateScale(11),
    fontWeight: '800',
    color: Colors.success,
  },
  newSignalBadgeSub: {
    fontSize: moderateScale(9),
    color: Colors.success,
    textAlign: 'center',
  },
  disclaimer: {
    fontSize: moderateScale(10),
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});

// ── No Live Signal ────────────────────────────────────────────

function NoLiveSignal() {
  return (
    <View style={emptyStyles.container}>
      <MaterialCommunityIcons name="signal-off" size={40} color={Colors.border} />
      <Text style={emptyStyles.title}>No Live Signal</Text>
      <Text style={emptyStyles.sub}>The last signal has expired. Stay tuned for new alerts.</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: Spacing.sm,
  },
  title: {
    fontSize: moderateScale(16),
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  sub: {
    fontSize: moderateScale(12),
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
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
        <Feather name="shopping-bag" size={36} color={Colors.border} />
        <Text style={emptyStyles.title}>No Trades Yet</Text>
        <Text style={emptyStyles.sub}>Confirmed orders will show here.</Text>
      </View>
    );
  }

  return (
    <View style={tradeStyles.list}>
      {orders.map(o => {
        const isBuy = o.signal.transaction_type === 'BUY';
        const pnl = o.realized_pnl;
        return (
          <View key={o.id} style={tradeStyles.card}>
            <View style={tradeStyles.row}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[tradeStyles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
                  <Text style={[tradeStyles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
                    {o.signal.transaction_type}
                  </Text>
                </View>
                <Text style={tradeStyles.title} numberOfLines={1}>{o.signal.title}</Text>
              </View>
              {pnl != null && (
                <Text style={[tradeStyles.pnl, { color: pnl >= 0 ? Colors.success : Colors.error }]}>
                  {pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`}
                </Text>
              )}
            </View>
            <View style={tradeStyles.meta}>
              <Text style={tradeStyles.metaText}>{o.signal.exchange_segment}</Text>
              <Text style={tradeStyles.metaText}>·</Text>
              <Text style={tradeStyles.metaText}>Entry ₹{o.signal.price}</Text>
              <Text style={tradeStyles.metaText}>·</Text>
              <Text style={tradeStyles.metaText}>{formatDateTimeIST(o.created_at)}</Text>
            </View>
          </View>
        );
      })}
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
    gap: 6,
    ...Shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  txBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  txText: { fontSize: 11, fontWeight: '800' },
  title: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  pnl: { fontSize: moderateScale(13), fontWeight: '800' },
  meta: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  metaText: { fontSize: moderateScale(11), color: Colors.textMuted },
});

// ── Coming Soon ───────────────────────────────────────────────

function ComingSoon({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={csStyles.container}>
      <View style={csStyles.iconWrap}>
        <Ionicons name={icon as any} size={40} color={Colors.primary} />
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
    paddingVertical: 48,
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: moderateScale(18),
    fontWeight: '800',
    color: Colors.text,
  },
  sub: {
    fontSize: moderateScale(13),
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
  badge: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primaryBg,
    borderRadius: Radius.full,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  badgeText: {
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: Colors.primary,
  },
});

// ─────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────

export default function HomeTabsSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Live Signals');

  // Live signal state
  const [latestSignal, setLatestSignal] = useState<SignalNotification | null>(null);
  const [signalAge, setSignalAge] = useState(0);
  const [signalLoading, setSignalLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLatestSignal = useCallback(async () => {
    try {
      const res = await userApi.getNotifications({ page: 1, pageSize: 1 });
      const first = res.items[0] ?? null;
      setLatestSignal(first);
      if (first) {
        setSignalAge(getSignalAge(first.created_at));
      }
    } catch {
      // keep existing
    } finally {
      setSignalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLatestSignal();

    // Poll every 5s for new signals
    pollRef.current = setInterval(fetchLatestSignal, SIGNAL_POLL_INTERVAL);

    // Tick countdown every second
    tickRef.current = setInterval(() => {
      setSignalAge(prev => {
        if (!latestSignal) return prev;
        return getSignalAge(latestSignal.created_at);
      });
    }, 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchLatestSignal]);

  // Update age ref when signal changes
  useEffect(() => {
    if (latestSignal) {
      setSignalAge(getSignalAge(latestSignal.created_at));
    }
  }, [latestSignal]);

  const isLive = latestSignal !== null && signalAge <= LIVE_SIGNAL_TTL_SECONDS;

  return (
    <View style={styles.container}>
      <TabBar active={activeTab} onSelect={setActiveTab} />

      <View style={styles.content}>
        {activeTab === 'Live Signals' && (
          signalLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : isLive ? (
            <LiveSignalCard notification={latestSignal!} countdown={signalAge} />
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
  },
});

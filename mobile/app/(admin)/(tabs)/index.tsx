import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Shadow, moderateScale } from '../../../constants/theme';
import { formatDateTimeIST } from '../../../utils/time';
import StatusBadge from '../../../components/StatusBadge';
import ExportDateRangeModal from '../../../components/ExportDateRangeModal';
import TelegramAutomationCard from '../../../components/TelegramAutomationCard';
import type { Dashboard } from '../../../types';

type FeatherName = keyof typeof Feather.glyphMap;

function formatPnl(value: number): string {
  const abs = Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value >= 0 ? `+₹${abs}` : `-₹${abs}`;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getDashboard();
      setStats(data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleExportAll = () => {
    setExportModalVisible(true);
  };

  const handleExportConfirm = async (dateFrom: string | null, dateTo: string | null) => {
    if (!dateFrom || !dateTo) {
      return;
    }
    if (dateFrom > dateTo) {
      return;
    }
    setExportModalVisible(false);
    setExporting(true);
    try {
      await adminApi.exportOrders({ date_from: dateFrom, date_to: dateTo });
    } catch {}
    finally { setExporting(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const pendingApprovals = stats?.pending_approvals ?? 0;
  const ipv6Missing = Math.max((stats?.users.active ?? 0) - (stats?.users.with_ipv6_assigned ?? 0), 0);
  const todayPnl = stats?.orders.today_pnl ?? 0;
  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata',
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.brandBar}>
        <View style={styles.brandRow}>
          <Image source={require('../../../assets/logo.jpeg')} style={styles.logoImage} resizeMode="contain" />
          <View style={styles.textGroup}>
            <Text style={styles.brandName}>Trading Floor</Text>
            <Text style={styles.brandCaption}>TRADE SMARTER TOGETHER</Text>
          </View>
        </View>
        <View style={styles.adminPill}>
          <Feather name="shield" size={11} color={Colors.primary} />
          <Text style={styles.adminPillText}>ADMIN</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[Colors.primary]} />}
      >
        <ExportDateRangeModal
          visible={exportModalVisible}
          onClose={() => setExportModalVisible(false)}
          onSubmit={handleExportConfirm}
        />

        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroGreeting}>Welcome back, Admin</Text>
              <Text style={styles.heroDate}>{todayLabel}</Text>
            </View>
            <View style={styles.heroIcon}>
              <Feather name="activity" size={16} color="#FFFFFF" />
            </View>
          </View>

          <View style={styles.heroStats}>
            <HeroStat label="Active Signals" value={String(stats?.signals.active ?? 0)} />
            <View style={styles.heroDivider} />
            <HeroStat label="Live Orders" value={String(stats?.orders.placed ?? 0)} />
            <View style={styles.heroDivider} />
            <HeroStat
              label="Today's P&L"
              value={formatPnl(todayPnl)}
              valueColor={todayPnl >= 0 ? '#86EFAC' : '#FCA5A5'}
              small
            />
          </View>
        </View>

        {/* Telegram automation */}
        <TelegramAutomationCard />

        {/* Needs Attention */}
        {(pendingApprovals > 0 || ipv6Missing > 0) && (
          <View style={styles.attentionCard}>
            <View style={styles.attentionHeader}>
              <Feather name="alert-circle" size={14} color={Colors.warning} />
              <Text style={styles.attentionTitle}>Needs Attention</Text>
            </View>
            {pendingApprovals > 0 && (
              <TouchableOpacity style={styles.attentionRow} onPress={() => router.push('/(admin)/(tabs)/approvals')} activeOpacity={0.75}>
                <View style={styles.attentionIcon}><Feather name="user-check" size={15} color={Colors.warning} /></View>
                <Text style={styles.attentionText}>
                  {pendingApprovals} user{pendingApprovals > 1 ? 's' : ''} awaiting approval
                </Text>
                <Feather name="chevron-right" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
            {ipv6Missing > 0 && (
              <TouchableOpacity style={styles.attentionRow} onPress={() => router.push('/(admin)/(tabs)/users')} activeOpacity={0.75}>
                <View style={styles.attentionIcon}><Feather name="wifi-off" size={15} color={Colors.warning} /></View>
                <Text style={styles.attentionText}>
                  {ipv6Missing} active user{ipv6Missing > 1 ? 's' : ''} missing an IPv6
                </Text>
                <Feather name="chevron-right" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActionsRow}>
          <QuickAction icon="plus" label="New Signal" tint={Colors.primary} tintBg={Colors.primaryBg} onPress={() => router.push('/(admin)/signal-create')} />
          <QuickAction icon="download" label="Export" tint={Colors.info} tintBg={Colors.infoBg} onPress={handleExportAll} loading={exporting} />
          <QuickAction icon="user-check" label="Approvals" tint={Colors.warning} tintBg={Colors.warningBg} onPress={() => router.push('/(admin)/(tabs)/approvals')} />
          <QuickAction icon="pie-chart" label="P&L" tint={Colors.success} tintBg={Colors.successBg} onPress={() => router.push('/(admin)/pnl')} />
        </View>

        {/* Orders health */}
        <Text style={styles.sectionTitle}>Orders</Text>
        <View style={styles.grid}>
          <StatTile icon="check-circle" label="Live Confirmed" value={stats?.orders.placed ?? 0} tint={Colors.success} tintBg={Colors.successBg} />
          <StatTile icon="clock" label="Awaiting Exchange" value={stats?.orders.awaiting_confirmation ?? 0} tint={Colors.warning} tintBg={Colors.warningBg} />
          <StatTile icon="x-circle" label="Exchange Rejected" value={stats?.orders.exchange_rejected ?? 0} tint={Colors.error} tintBg={Colors.errorBg} />
          <StatTile icon="alert-triangle" label="Failed" value={stats?.orders.failed ?? 0} tint={Colors.error} tintBg={Colors.errorBg} />
        </View>
        <Text style={styles.helperText}>
          "Live Confirmed" counts only orders confirmed by Dhan's exchange feed, not just requests accepted by the API.
        </Text>

        {/* Users */}
        <Text style={styles.sectionTitle}>Users</Text>
        <View style={styles.grid}>
          <StatTile icon="users" label="Total Users" value={stats?.users.total ?? 0} tint={Colors.primary} tintBg={Colors.primaryBg} />
          <StatTile icon="user-check" label="Active Users" value={stats?.users.active ?? 0} tint={Colors.success} tintBg={Colors.successBg} />
          <StatTile icon="link" label="Dhan Connected" value={stats?.users.with_dhan_credential ?? 0} tint={Colors.info} tintBg={Colors.infoBg} />
          <StatTile icon="wifi-off" label="Missing IPv6" value={ipv6Missing} tint={ipv6Missing > 0 ? Colors.warning : Colors.textMuted} tintBg={ipv6Missing > 0 ? Colors.warningBg : '#F3F4F6'} />
        </View>

        {/* Recent Signals */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Signals</Text>
          <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/(admin)/(tabs)/signals')}>
            <Text style={styles.linkText}>View All</Text>
            <Feather name="arrow-right" size={13} color={Colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.recentList}>
          {stats?.recent_signals && stats.recent_signals.length > 0 ? (
            stats.recent_signals.map((s, idx) => (
              <RecentSignalRow key={s.id} signal={s} isLast={idx === stats.recent_signals.length - 1} />
            ))
          ) : (
            <Text style={styles.emptyRecent}>No signals created yet.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeroStat({ label, value, valueColor, small }: { label: string; value: string; valueColor?: string; small?: boolean }) {
  return (
    <View style={styles.heroStat}>
      <Text
        style={[styles.heroStatValue, small && styles.heroStatValueSmall, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress, loading, tint, tintBg }: {
  icon: FeatherName; label: string; onPress: () => void; loading?: boolean; tint: string; tintBg: string;
}) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress} disabled={loading} activeOpacity={0.75}>
      <View style={[styles.quickActionIcon, { backgroundColor: tintBg }]}>
        {loading ? <ActivityIndicator size="small" color={tint} /> : <Feather name={icon} size={18} color={tint} />}
      </View>
      <Text style={styles.quickActionText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function StatTile({ icon, label, value, tint, tintBg }: {
  icon: FeatherName; label: string; value: number; tint: string; tintBg: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: tintBg }]}>
        <Feather name={icon} size={16} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

function RecentSignalRow({ signal, isLast }: { signal: NonNullable<Dashboard['recent_signals']>[number]; isLast: boolean }) {
  const isBuy = signal.transaction_type === 'BUY';
  const pct = signal.total_notified > 0 ? Math.min(100, Math.round((signal.placed / signal.total_notified) * 100)) : 0;
  return (
    <TouchableOpacity
      style={[styles.recentRow, isLast && { borderBottomWidth: 0 }]}
      onPress={() => router.push({ pathname: '/(admin)/signal/[id]', params: { id: signal.id } })}
      activeOpacity={0.75}
    >
      {signal.transaction_type && (
        <View style={[styles.recentTx, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
          <Text style={[styles.recentTxText, { color: isBuy ? Colors.buy : Colors.sell }]}>{signal.transaction_type}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.recentTitle} numberOfLines={1}>{signal.title}</Text>
        <Text style={styles.recentMeta}>{formatDateTimeIST(signal.created_at)} · {signal.placed}/{signal.total_notified} placed</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </View>
      <StatusBadge status={signal.lifecycle ?? signal.status} size="sm" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },

  brandBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoImage: { width: 32, height: 32, borderRadius: 6 },
  textGroup: { gap: 1 },
  brandName: { fontSize: moderateScale(20), fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  brandCaption: { fontSize: moderateScale(9), fontWeight: '600', color: Colors.textMuted, letterSpacing: 1.5 },
  adminPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  adminPillText: { color: Colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  hero: {
    backgroundColor: '#1E3A8A', borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm + 4,
    ...Shadow.card,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroGreeting: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  heroDate: { fontSize: 11, color: '#BFDBFE', marginTop: 2 },
  heroIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  heroStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.md, paddingVertical: Spacing.sm,
  },
  heroStat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  heroStatValue: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  heroStatValueSmall: { fontSize: 15 },
  heroStatLabel: { fontSize: 10, fontWeight: '600', color: '#BFDBFE', textTransform: 'uppercase', letterSpacing: 0.4 },
  heroDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.2)' },

  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 4 },
  linkText: { fontSize: 13, fontWeight: '700', color: Colors.primary },

  attentionCard: {
    backgroundColor: Colors.warningBg, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  attentionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attentionTitle: { fontSize: 12, fontWeight: '800', color: Colors.warning, textTransform: 'uppercase', letterSpacing: 0.8 },
  attentionRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.sm,
  },
  attentionIcon: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.warningBg,
  },
  attentionText: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '600' },

  quickActionsRow: { flexDirection: 'row', gap: Spacing.sm },
  quickAction: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md,
    paddingVertical: Spacing.md, paddingHorizontal: 4, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.card,
  },
  quickActionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  quickActionText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statTile: {
    width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.sm + 4,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.card,
  },
  statIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: moderateScale(20), fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  helperText: { fontSize: 11, color: Colors.textMuted, lineHeight: 16 },

  recentList: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border, ...Shadow.card,
  },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  recentTx: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  recentTxText: { fontSize: 10, fontWeight: '800' },
  recentTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  recentMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: Colors.success },
  emptyRecent: { padding: Spacing.md, fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
});

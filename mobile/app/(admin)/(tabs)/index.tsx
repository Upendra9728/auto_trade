import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';
import { formatDateTimeIST } from '../../../utils/time';
import StatusBadge from '../../../components/StatusBadge';
import type { Dashboard } from '../../../types';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getDashboard();
      setStats(data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleExportAll = async () => {
    setExporting(true);
    try {
      await adminApi.exportOrders({});
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[Colors.primary]} />}
      >
        {/* Header */}
        <View style={styles.headerBar}>
          <View>
            <Text style={styles.greeting}>Welcome, {user?.name}</Text>
            <Text style={styles.roleText}>Admin Dashboard</Text>
          </View>
          <View style={styles.adminPill}><Text style={styles.adminPillText}>ADMIN</Text></View>
        </View>

        {/* Needs Attention */}
        {(pendingApprovals > 0 || ipv6Missing > 0) && (
          <View style={styles.attentionCard}>
            <Text style={styles.sectionTitle}>Needs Attention</Text>
            {pendingApprovals > 0 && (
              <TouchableOpacity style={styles.attentionRow} onPress={() => router.push('/(admin)/(tabs)/approvals')}>
                <Feather name="user-check" size={16} color={Colors.warning} />
                <Text style={styles.attentionText}>
                  {pendingApprovals} user{pendingApprovals > 1 ? 's' : ''} awaiting approval
                </Text>
                <Feather name="chevron-right" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
            {ipv6Missing > 0 && (
              <TouchableOpacity style={styles.attentionRow} onPress={() => router.push('/(admin)/(tabs)/users')}>
                <Feather name="wifi-off" size={16} color={Colors.warning} />
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
          <QuickAction icon="plus-circle" label="New Signal" onPress={() => router.push('/(admin)/signal-create')} />
          <QuickAction icon="download" label="Export Report" onPress={handleExportAll} loading={exporting} />
          <QuickAction icon="user-check" label="Approvals" onPress={() => router.push('/(admin)/(tabs)/approvals')} />
          <QuickAction icon="pie-chart" label="P&L" onPress={() => router.push('/(admin)/pnl')} />
        </View>

        {/* Key metrics */}
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.grid}>
          <StatCard label="Active Signals" value={stats?.signals.active ?? 0} color={Colors.primary} />
          <StatCard label="Live Confirmed" value={stats?.orders.placed ?? 0} color={Colors.success} />
          <StatCard label="Pending Approvals" value={pendingApprovals} color={Colors.warning} />
          <StatCard
            label="Realized P&L"
            value={stats?.orders.total_realized_pnl ?? 0}
            color={(stats?.orders.total_realized_pnl ?? 0) >= 0 ? Colors.success : Colors.error}
            isCurrency
          />
        </View>
        <Text style={styles.helperText}>
          "Live Confirmed" counts only orders confirmed by Dhan's exchange feed (TRANSIT/PENDING/TRADED) —
          not just requests accepted by the API.
        </Text>

        {/* Recent Signals */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionTitle}>Recent Signals</Text>
          <TouchableOpacity style={styles.pnlLinkBtn} onPress={() => router.push('/(admin)/(tabs)/signals')}>
            <Text style={styles.pnlLinkText}>View All →</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.recentList}>
          {stats?.recent_signals && stats.recent_signals.length > 0 ? (
            stats.recent_signals.map((s) => <RecentSignalRow key={s.id} signal={s} />)
          ) : (
            <Text style={styles.helperText}>No signals created yet.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon, label, onPress, loading }: {
  icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; loading?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress} disabled={loading} activeOpacity={0.75}>
      {loading ? <ActivityIndicator size="small" color={Colors.primary} /> : <Feather name={icon} size={20} color={Colors.primary} />}
      <Text style={styles.quickActionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function RecentSignalRow({ signal }: { signal: NonNullable<Dashboard['recent_signals']>[number] }) {
  return (
    <TouchableOpacity
      style={styles.recentRow}
      onPress={() => router.push({ pathname: '/(admin)/signal/[id]', params: { id: signal.id } })}
      activeOpacity={0.75}
    >
      <View style={{ flex: 1, marginRight: Spacing.sm }}>
        <Text style={styles.recentTitle} numberOfLines={1}>{signal.title}</Text>
        <Text style={styles.recentMeta}>{formatDateTimeIST(signal.created_at)} · {signal.placed}/{signal.total_notified} placed</Text>
      </View>
      <StatusBadge status={signal.status} size="sm" />
      <Feather name="chevron-right" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

function StatCard({ label, value, color, isCurrency }: { label: string; value: number; color: string; isCurrency?: boolean }) {
  const display = isCurrency
    ? (value >= 0 ? `+₹${value.toFixed(2)}` : `-₹${Math.abs(value).toFixed(2)}`)
    : String(value);
  return (
    <View style={[styles.statCard, { borderTopColor: color, borderTopWidth: 3 }]}>
      <Text style={[styles.statValue, isCurrency && styles.statValueCurrency, { color }]}>{display}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg },
  headerBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, ...Shadow.card,
  },
  greeting: { ...Typography.h3 },
  roleText: { ...Typography.bodySmall, marginTop: 2 },
  adminPill: {
    backgroundColor: Colors.primaryBg, paddingHorizontal: 12, paddingVertical: 4, borderRadius: Radius.full,
  },
  adminPillText: { color: Colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  sectionTitle: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.8 },
  pnlLinkBtn: { paddingVertical: 2, paddingHorizontal: 6 },
  pnlLinkText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  attentionCard: {
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  attentionRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.sm, padding: Spacing.sm,
  },
  attentionText: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '600' },
  quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quickAction: {
    flex: 1, minWidth: '22%', backgroundColor: Colors.surface, borderRadius: Radius.sm,
    paddingVertical: Spacing.md, alignItems: 'center', gap: 6, ...Shadow.card,
  },
  quickActionText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: Colors.surface, borderRadius: Radius.sm,
    padding: Spacing.md, alignItems: 'center', ...Shadow.card, gap: 4,
  },
  statValue: { fontSize: 28, fontWeight: '800' },
  statValueCurrency: { fontSize: 20 },
  statLabel: { ...Typography.caption, textTransform: 'uppercase', letterSpacing: 0.5 },
  helperText: { ...Typography.caption, lineHeight: 16 },
  recentList: { backgroundColor: Colors.surface, borderRadius: Radius.md, ...Shadow.card, overflow: 'hidden' },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  recentTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  recentMeta: { ...Typography.caption, marginTop: 2 },
});

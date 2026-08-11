import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import type { Dashboard } from '../../types';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getDashboard();
      setStats(data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

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

        {/* Users section */}
        <Text style={styles.sectionTitle}>Users</Text>
        <View style={styles.grid}>
          <StatCard label="Total" value={stats?.users.total ?? 0} color={Colors.primary} />
          <StatCard label="Active" value={stats?.users.active ?? 0} color={Colors.success} />
          <StatCard label="With IPv6" value={stats?.users.with_ipv6_assigned ?? 0} color={Colors.info} />
          <StatCard label="With Dhan" value={stats?.users.with_dhan_credential ?? 0} color={Colors.warning} />
        </View>

        {/* Signals section */}
        <Text style={styles.sectionTitle}>Signals</Text>
        <View style={styles.grid}>
          <StatCard label="Total" value={stats?.signals.total ?? 0} color={Colors.primary} />
          <StatCard label="Active" value={stats?.signals.active ?? 0} color={Colors.success} />
        </View>

        {/* Orders section */}
        <Text style={styles.sectionTitle}>Orders</Text>
        <View style={styles.grid}>
          <StatCard label="Pending" value={stats?.orders.pending ?? 0} color={Colors.warning} />
          <StatCard label="Live Confirmed" value={stats?.orders.placed ?? 0} color={Colors.success} />
          <StatCard label="Awaiting Live" value={stats?.orders.awaiting_confirmation ?? 0} color={Colors.info} />
          <StatCard label="Exchange Rejected" value={stats?.orders.exchange_rejected ?? 0} color={Colors.error} />
          <StatCard label="Failed" value={stats?.orders.failed ?? 0} color={Colors.error} />
        </View>
        <Text style={styles.helperText}>
          "Live Confirmed" counts only orders confirmed by Dhan's exchange feed (TRANSIT/PENDING/TRADED) —
          not just requests accepted by the API.
        </Text>

        {/* Readiness warning */}
        {(stats?.users.with_ipv6_assigned ?? 0) < (stats?.users.active ?? 0) && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              ⚠️ {(stats!.users.active - stats!.users.with_ipv6_assigned)} active user(s) don't have an IPv6 assigned. Go to Users to assign.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statCard, { borderTopColor: color, borderTopWidth: 3 }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: Colors.surface, borderRadius: Radius.sm,
    padding: Spacing.md, alignItems: 'center', ...Shadow.card, gap: 4,
  },
  statValue: { fontSize: 28, fontWeight: '800' },
  statLabel: { ...Typography.caption, textTransform: 'uppercase', letterSpacing: 0.5 },
  warnBox: { backgroundColor: Colors.warningBg, borderRadius: Radius.sm, padding: Spacing.md },
  warnText: { fontSize: 13, color: Colors.warning, lineHeight: 18 },
  helperText: { ...Typography.caption, lineHeight: 16 },
});

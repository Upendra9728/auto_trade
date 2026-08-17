import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateIST } from '../../utils/time';
import EmptyState from '../../components/EmptyState';
import type { AdminUserPnlRow, UserPosition } from '../../types';

export default function AdminPnlScreen() {
  const [tab, setTab] = useState<'users' | 'positions'>('users');
  const [usersPnl, setUsersPnl] = useState<AdminUserPnlRow[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pnlData, posData] = await Promise.all([
        adminApi.getUsersPnl({ search: search.trim() || undefined }),
        adminApi.getPositions(),
      ]);
      setUsersPnl(pnlData);
      setPositions(posData);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const totalRealized = usersPnl.reduce((acc: number, u: AdminUserPnlRow) => acc + u.total_realized_pnl, 0);
  const totalUnrealized = positions.reduce((acc: number, p: UserPosition) => acc + p.unrealized_profit, 0);
  const totalDhanRealized = positions.reduce((acc: number, p: UserPosition) => acc + p.realized_profit, 0);

  const renderUserPnlRow = ({ item: u }: { item: AdminUserPnlRow }) => {
    const isPos = u.total_realized_pnl >= 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nameText}>{u.user_name}</Text>
            <Text style={styles.emailText}>{u.user_email}</Text>
          </View>
          <View style={[styles.pnlTag, { backgroundColor: isPos ? Colors.successBg : Colors.errorBg }]}>
            <Text style={[styles.pnlTagText, { color: isPos ? Colors.success : Colors.error }]}>
              {isPos ? `+₹${u.total_realized_pnl.toFixed(2)}` : `-₹${Math.abs(u.total_realized_pnl).toFixed(2)}`}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Orders</Text>
            <Text style={styles.statValue}>{u.total_orders} ({u.closed_orders} closed)</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Win / Loss</Text>
            <Text style={styles.statValue}>
              <Text style={{ color: Colors.success, fontWeight: '700' }}>{u.win_count}W</Text> / <Text style={{ color: Colors.error, fontWeight: '700' }}>{u.loss_count}L</Text>
            </Text>
          </View>
        </View>

        {(u.dhan_realized_profit !== 0 || u.dhan_unrealized_profit !== 0) && (
          <View style={styles.dhanRow}>
            <Text style={styles.dhanLabel}>Dhan Positions P&L:</Text>
            <Text style={[styles.dhanVal, { color: u.dhan_unrealized_profit >= 0 ? Colors.success : Colors.error }]}>
              Unrealized: {u.dhan_unrealized_profit >= 0 ? `+₹${u.dhan_unrealized_profit.toFixed(2)}` : `-₹${Math.abs(u.dhan_unrealized_profit).toFixed(2)}`}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderPositionRow = ({ item: p }: { item: UserPosition }) => {
    const isLong = p.position_type === 'LONG';
    const isUnrealizedPos = p.unrealized_profit >= 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nameText}>{p.trading_symbol || p.security_id}</Text>
            <Text style={styles.emailText}>User: {p.user_name || p.user_email || `ID ${p.user_id}`}</Text>
          </View>
          <View style={[styles.typeBadge, { backgroundColor: isLong ? Colors.buyBg : Colors.sellBg }]}>
            <Text style={[styles.typeText, { color: isLong ? Colors.buy : Colors.sell }]}>
              {p.position_type} · Qty {p.net_qty}
            </Text>
          </View>
        </View>

        <View style={styles.metaInfoRow}>
          <Text style={styles.metaText}>{p.exchange_segment} · {p.product_type}</Text>
          <Text style={styles.metaText}>Avg: ₹{p.buy_avg.toFixed(2)}</Text>
        </View>

        <View style={styles.pnlSplitRow}>
          <View style={styles.pnlBox}>
            <Text style={styles.pnlBoxLabel}>Unrealized P&L</Text>
            <Text style={[styles.pnlBoxValue, { color: isUnrealizedPos ? Colors.success : Colors.error }]}>
              {isUnrealizedPos ? `+₹${p.unrealized_profit.toFixed(2)}` : `-₹${Math.abs(p.unrealized_profit).toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.pnlBox}>
            <Text style={styles.pnlBoxLabel}>Realized P&L</Text>
            <Text style={[styles.pnlBoxValue, { color: p.realized_profit >= 0 ? Colors.success : Colors.error }]}>
              {p.realized_profit >= 0 ? `+₹${p.realized_profit.toFixed(2)}` : `-₹${Math.abs(p.realized_profit).toFixed(2)}`}
            </Text>
          </View>
        </View>

        <Text style={styles.timeCaption}>Updated: {formatDateIST(p.updated_at)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={Colors.primary} />
          <Text style={styles.backText}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle}>P&L & Positions</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Overview Totals Card */}
      <View style={styles.overviewCard}>
        <View style={styles.overviewItem}>
          <Text style={styles.overviewLabel}>Total Signal P&L</Text>
          <Text style={[styles.overviewValue, { color: totalRealized >= 0 ? Colors.success : Colors.error }]}>
            {totalRealized >= 0 ? `+₹${totalRealized.toFixed(2)}` : `-₹${Math.abs(totalRealized).toFixed(2)}`}
          </Text>
        </View>
        <View style={styles.overviewItem}>
          <Text style={styles.overviewLabel}>Live Open Unrealized</Text>
          <Text style={[styles.overviewValue, { color: totalUnrealized >= 0 ? Colors.success : Colors.error }]}>
            {totalUnrealized >= 0 ? `+₹${totalUnrealized.toFixed(2)}` : `-₹${Math.abs(totalUnrealized).toFixed(2)}`}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'users' && styles.tabBtnActive]}
          onPress={() => setTab('users')}
        >
          <Text style={[styles.tabText, tab === 'users' && styles.tabTextActive]}>
            Users P&L ({usersPnl.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'positions' && styles.tabBtnActive]}
          onPress={() => setTab('positions')}
        >
          <Text style={[styles.tabText, tab === 'positions' && styles.tabTextActive]}>
            Live Positions ({positions.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search (when in users tab) */}
      {tab === 'users' && (
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or email..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={tab === 'users' ? usersPnl : positions}
          keyExtractor={(item: any) => String(item.id || item.user_id)}
          renderItem={tab === 'users' ? (renderUserPnlRow as any) : (renderPositionRow as any)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="trending-up"
              title={tab === 'users' ? 'No P&L records' : 'No open positions'}
              subtitle={tab === 'users' ? 'User order P&L will appear here once closed.' : 'Live positions from Dhan will sync automatically.'}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  pageTitle: { ...Typography.h3 },

  overviewCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Shadow.card,
    gap: Spacing.md,
  },
  overviewItem: { flex: 1, alignItems: 'center' },
  overviewLabel: { ...Typography.caption, textTransform: 'uppercase', letterSpacing: 0.5 },
  overviewValue: { fontSize: 18, fontWeight: '800', marginTop: 4 },

  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: Radius.sm - 2,
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },

  list: { padding: Spacing.md, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Shadow.card,
    gap: 8,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  nameText: { fontSize: 15, fontWeight: '700', color: Colors.text },
  emailText: { ...Typography.caption, color: Colors.textSecondary, marginTop: 1 },
  pnlTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.sm },
  pnlTagText: { fontSize: 14, fontWeight: '800' },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  statItem: { flex: 1 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' },
  statValue: { fontSize: 13, fontWeight: '600', color: Colors.text, marginTop: 2 },

  dhanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  dhanLabel: { fontSize: 12, color: Colors.textSecondary },
  dhanVal: { fontSize: 12, fontWeight: '700' },

  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.sm },
  typeText: { fontSize: 11, fontWeight: '800' },
  metaInfoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { fontSize: 12, color: Colors.textSecondary },

  pnlSplitRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  pnlBox: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    alignItems: 'center',
  },
  pnlBoxLabel: { fontSize: 11, color: Colors.textMuted },
  pnlBoxValue: { fontSize: 14, fontWeight: '800', marginTop: 2 },

  timeCaption: { ...Typography.caption, color: Colors.textMuted, textAlign: 'right' },
});

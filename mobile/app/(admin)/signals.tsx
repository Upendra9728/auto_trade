import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateTimeIST } from '../../utils/time';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import Pagination from '../../components/Pagination';
import DateRangeFilter from '../../components/DateRangeFilter';
import { Feather } from '@expo/vector-icons';
import type { Signal, PaginationMeta } from '../../types';

export default function AdminSignalsScreen() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (targetPage: number, from: string | null, to: string | null) => {
    try {
      const data = await adminApi.getSignals({ page: targetPage, date_from: from, date_to: to });
      setSignals(data.items);
      setMeta(data.meta);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(page, dateFrom, dateTo); }, [load, page, dateFrom, dateTo]);

  const handleDateChange = (from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const handleRefresh = () => { setRefreshing(true); load(page, dateFrom, dateTo); };

  const handleCancel = (s: Signal) => {
    Alert.alert('Cancel Signal', `Cancel "${s.title}"? All pending notifications will be rejected.`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel Signal', style: 'destructive',
        onPress: async () => {
          try {
            await adminApi.cancelSignal(s.id);
            load(page, dateFrom, dateTo);
          } catch (err: any) { Alert.alert('Error', err.message); }
        },
      },
    ]);
  };

  const renderItem = ({ item: s }: { item: Signal }) => {
    const isBuy = s.transaction_type === 'BUY';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push({ pathname: '/(admin)/signal/[id]', params: { id: s.id } })}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <View style={[styles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
            <Text style={[styles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>{s.transaction_type}</Text>
          </View>
          <StatusBadge status={s.status} size="sm" />
        </View>

        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.meta}>{s.exchange_segment} · Security {s.security_id} · Qty {s.quantity}</Text>

        {/* Notification progress */}
        {s.total_notified !== undefined && (
          <View style={styles.progress}>
            <ProgressPill label="Notified" value={s.total_notified} color={Colors.primary} />
            <ProgressPill label="Placed" value={s.placed ?? 0} color={Colors.success} />
            <ProgressPill label="Pending" value={(s.total_notified ?? 0) - (s.placed ?? 0) - (s.rejected ?? 0) - (s.failed ?? 0) - (s.confirmed ?? 0)} color={Colors.warning} />
            <ProgressPill label="Failed" value={s.failed ?? 0} color={Colors.error} />
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.timeText}>{formatDateTimeIST(s.created_at)}</Text>
          {s.status === 'active' && (
            <TouchableOpacity onPress={() => handleCancel(s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.cancelLink}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.pageTitle}>Signals</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/(admin)/signal-create')}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.createText}>New Signal</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterBar}>
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
      </View>

      <FlatList
        data={signals}
        keyExtractor={(s) => String(s.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, !signals.length && { flex: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[Colors.primary]} />}
        ListEmptyComponent={<EmptyState icon="radio" title="No signals yet" subtitle='Tap "New Signal" to broadcast a trading signal to all users.' />}
        showsVerticalScrollIndicator={false}
      />

      <Pagination meta={meta} onPageChange={setPage} loading={loading} />
    </SafeAreaView>
  );
}

function ProgressPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 10, color: Colors.textMuted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pageTitle: { ...Typography.h3 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.sm,
  },
  createText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  filterBar: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  list: { padding: Spacing.md, gap: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card, gap: 8 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full },
  txText: { fontSize: 12, fontWeight: '800' },
  title: { ...Typography.h3 },
  meta: { ...Typography.caption },
  progress: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: Colors.background, borderRadius: Radius.sm, paddingVertical: 8,
  },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeText: { ...Typography.caption },
  cancelLink: { fontSize: 13, color: Colors.error, fontWeight: '700' },
});

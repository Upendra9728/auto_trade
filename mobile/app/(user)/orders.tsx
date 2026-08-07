import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { userApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateTimeIST } from '../../utils/time';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import type { SignalNotification } from '../../types';

export default function OrdersScreen() {
  const [orders, setOrders] = useState<SignalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await userApi.getOrders();
      setOrders(data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      const intervalId = setInterval(() => {
        load();
      }, 7000);
      return () => clearInterval(intervalId);
    }, [load]),
  );

  const renderItem = ({ item: o }: { item: SignalNotification }) => {
    const isBuy = o.signal.transaction_type === 'BUY';
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
            <Text style={[styles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
              {o.signal.transaction_type}
            </Text>
          </View>
          <StatusBadge status={o.status} size="sm" />
        </View>

        <Text style={styles.title}>{o.signal.title}</Text>
        <Text style={styles.meta}>
          {o.signal.exchange_segment} · {o.signal.security_id} · Qty {o.signal.quantity}
        </Text>

        <View style={styles.priceRow}>
          <Text style={styles.price}>Entry ₹{o.signal.price}</Text>
          <Text style={[styles.price, { color: Colors.error }]}>SL ₹{o.signal.stop_loss_price}</Text>
          <Text style={[styles.price, { color: Colors.success }]}>Target ₹{o.signal.target_price}</Text>
        </View>

        {o.status === 'placed' && (
          <View style={styles.resultBox}>
            <Text style={styles.successText}>✅ Order ID: {o.dhan_order_id}</Text>
            {o.placed_at && <Text style={styles.timeText}>Placed at {formatDateTimeIST(o.placed_at)}</Text>}
          </View>
        )}
        {o.status === 'failed' && (
          <View style={[styles.resultBox, { backgroundColor: Colors.errorBg }]}>
            <Text style={styles.errorText}>❌ {o.error_message ?? 'Order failed'}</Text>
          </View>
        )}
      </View>
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
        <Text style={styles.pageTitle}>Order History</Text>
        <Text style={styles.count}>{orders.length} orders</Text>
      </View>
      <FlatList
        data={orders}
        keyExtractor={(o) => String(o.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, !orders.length && { flex: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[Colors.primary]} />}
        ListEmptyComponent={<EmptyState icon="shopping-bag" title="No orders yet" subtitle="Confirmed orders will appear here." />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
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
  count: { ...Typography.bodySmall },
  list: { padding: Spacing.md, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, ...Shadow.card, gap: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full },
  txText: { fontSize: 12, fontWeight: '800' },
  title: { ...Typography.h3 },
  meta: { ...Typography.caption },
  priceRow: { flexDirection: 'row', gap: Spacing.md },
  price: { fontSize: 13, fontWeight: '600', color: Colors.text },
  resultBox: { backgroundColor: Colors.successBg, borderRadius: Radius.sm, padding: Spacing.sm, gap: 2 },
  successText: { fontSize: 13, color: Colors.success, fontWeight: '600' },
  errorText: { fontSize: 13, color: Colors.error, fontWeight: '600' },
  timeText: { fontSize: 11, color: Colors.textMuted },
});

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { userApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import type { SignalNotification } from '../../types';

export default function NotificationsScreen() {
  const [items, setItems] = useState<SignalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(async (showError = true) => {
    try {
      const data = await userApi.getNotifications();
      setItems(data);
    } catch (err: any) {
      if (showError) {
        Alert.alert('Error', err.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useFocusEffect(
    useCallback(() => {
      load(false);
      const intervalId = setInterval(() => {
        load(false);
      }, 5000);
      return () => clearInterval(intervalId);
    }, [load]),
  );

  const handleConfirm = async (n: SignalNotification) => {
    Alert.alert(
      'Confirm Order',
      `Place order for "${n.signal.title}"?\n\n${n.signal.transaction_type} ${n.signal.quantity} × ${n.signal.exchange_segment}\nEntry ₹${n.signal.price}  SL ₹${n.signal.stop_loss_price}  Target ₹${n.signal.target_price}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'default',
          onPress: async () => {
            setActionId(n.id);
            try {
              const updated = await userApi.confirmNotification(n.id);
              setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
              if (updated.status === 'placed') {
                Alert.alert('✅ Order Placed', `Dhan Order ID: ${updated.dhan_order_id ?? 'N/A'}`);
              } else {
                Alert.alert('❌ Order Failed', updated.error_message ?? 'Unknown error');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setActionId(null);
            }
          },
        },
      ],
    );
  };

  const handleReject = async (n: SignalNotification) => {
    setActionId(n.id);
    try {
      const updated = await userApi.rejectNotification(n.id);
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionId(null);
    }
  };

  const renderItem = ({ item: n }: { item: SignalNotification }) => {
    const isBusy = actionId === n.id;
    const isPending = n.status === 'pending';
    const isBuy = n.signal.transaction_type === 'BUY';

    return (
      <View style={styles.card}>
        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={[styles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
            <Text style={[styles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
              {n.signal.transaction_type}
            </Text>
          </View>
          <StatusBadge status={n.status} size="sm" />
        </View>

        {/* Title */}
        <Text style={styles.signalTitle}>{n.signal.title}</Text>
        <Text style={styles.segment}>{n.signal.exchange_segment} · {n.signal.security_id}</Text>

        {/* Price grid */}
        <View style={styles.priceGrid}>
          <PriceCell label="Entry" value={n.signal.price} />
          <PriceCell label="Stop Loss" value={n.signal.stop_loss_price} color={Colors.error} />
          <PriceCell label="Target" value={n.signal.target_price} color={Colors.success} />
          <PriceCell label="Qty" value={n.signal.quantity} isInt />
        </View>

        {/* Result info */}
        {n.status === 'placed' && (
          <View style={styles.resultRow}>
            <Text style={styles.resultSuccess}>✅ Placed · Order ID: {n.dhan_order_id}</Text>
          </View>
        )}
        {n.status === 'failed' && (
          <View style={styles.resultRow}>
            <Text style={styles.resultError}>❌ {n.error_message}</Text>
          </View>
        )}

        {/* Action buttons */}
        {isPending && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => handleReject(n)}
              disabled={isBusy}
            >
              {isBusy ? <ActivityIndicator size="small" color={Colors.textSecondary} /> : <Text style={styles.rejectText}>Reject</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmBtn]}
              onPress={() => handleConfirm(n)}
              disabled={isBusy}
            >
              {isBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmText}>Confirm & Place</Text>}
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.time}>{new Date(n.created_at).toLocaleString()}</Text>
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
        <Text style={styles.pageTitle}>Signals</Text>
        <Text style={styles.pendingCount}>
          {items.filter((n) => n.status === 'pending').length} pending
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, !items.length && { flex: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[Colors.primary]} />}
        ListEmptyComponent={<EmptyState icon="bell-off" title="No signals yet" subtitle="When the admin sends a trading signal, it will appear here." />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function PriceCell({ label, value, color, isInt }: { label: string; value: number; color?: string; isInt?: boolean }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 11, color: Colors.textMuted, marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: '700', color: color ?? Colors.text }}>
        {isInt ? value : `₹${value}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pageTitle: { ...Typography.h3 },
  pendingCount: { fontSize: 13, color: Colors.warning, fontWeight: '700' },
  list: { padding: Spacing.md, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Shadow.card,
    gap: Spacing.sm,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full },
  txText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  signalTitle: { ...Typography.h3 },
  segment: { ...Typography.caption },
  priceGrid: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: Radius.sm, padding: Spacing.sm, marginVertical: 4 },
  resultRow: { backgroundColor: Colors.background, borderRadius: Radius.sm, padding: Spacing.sm },
  resultSuccess: { fontSize: 13, color: Colors.success, fontWeight: '600' },
  resultError: { fontSize: 13, color: Colors.error, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  actionBtn: { flex: 1, paddingVertical: 11, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  rejectBtn: { backgroundColor: Colors.background, borderWidth: 1.5, borderColor: Colors.border },
  confirmBtn: { backgroundColor: Colors.primary },
  rejectText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  time: { ...Typography.caption, textAlign: 'right' },
});

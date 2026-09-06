import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';
import { formatDateTimeIST } from '../../../utils/time';
import StatusBadge from '../../../components/StatusBadge';
import EmptyState from '../../../components/EmptyState';
import AdminScreenHeader from '../../../components/AdminScreenHeader';
import { Feather } from '@expo/vector-icons';
import DayGroupedList from '../../../components/DayGroupedList';
import type { Signal } from '../../../types';

export default function AdminSignalsScreen() {
  const insets = useSafeAreaInsets();
  const [exporting, setExporting] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setRefreshNonce((value: number) => value + 1);
    }, []),
  );

  const handleExportOrders = async () => {
    setExporting(true);
    try {
      await adminApi.exportOrders({});
    } catch (err: any) {
      Alert.alert('Export failed', err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleCancel = (s: Signal) => {
    Alert.alert('Cancel Signal', `Cancel "${s.title}"? All pending notifications will be rejected.`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel Signal', style: 'destructive',
        onPress: async () => {
          try {
            await adminApi.cancelSignal(s.id);
            setRefreshNonce((value: number) => value + 1);
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

        {s.total_notified !== undefined && (
          <View style={styles.progress}>
            <ProgressPill label="Notified" value={s.total_notified} color={Colors.primary} />
            <ProgressPill label="Submitted" value={s.placed ?? 0} color={Colors.success} />
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

  return (
    <SafeAreaView style={styles.container}>
      <AdminScreenHeader title="Signals" />

      <View style={styles.filterBar}>
        <TouchableOpacity style={styles.exportBtn} onPress={handleExportOrders} disabled={exporting}>
          {exporting ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Feather name="download" size={14} color={Colors.primary} />
          )}
          <Text style={styles.exportText}>Export Report</Text>
        </TouchableOpacity>
      </View>

      <DayGroupedList<Signal>
        refreshNonce={refreshNonce}
        fetchDays={({ page, pageSize }) => adminApi.getSignalDays({ page, pageSize })}
        fetchItemsForDay={({ date, page, pageSize }) => adminApi.getSignals({ page, pageSize, date_from: date, date_to: date })}
        renderItem={renderItem}
        keyExtractor={(s) => String(s.id)}
        ListEmptyComponent={<EmptyState icon="radio" title="No signals yet" subtitle='Tap the + button below to broadcast a trading signal to all users.' />}
      />

      <TouchableOpacity
        style={[styles.fab, { bottom: 60 + insets.bottom + Spacing.md }]}
        onPress={() => router.push('/(admin)/signal-create')}
        activeOpacity={0.85}
      >
        <Feather name="plus" size={26} color="#fff" />
      </TouchableOpacity>
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
  filterBar: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryBg,
  },
  exportText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
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
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
    shadowOpacity: 0.25,
    elevation: 6,
  },
});

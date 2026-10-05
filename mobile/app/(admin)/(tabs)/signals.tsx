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
import ExportDateRangeModal from '../../../components/ExportDateRangeModal';
import TradeInsightsModal from '../../../components/TradeInsightsModal';
import SignalPriceBar from '../../../components/SignalPriceBar';
import AudienceBadge from '../../../components/AudienceBadge';
import AudienceGroupsModal from '../../../components/AudienceGroupsModal';
import { useLiveLtp } from '../../../hooks/useLiveLtp';
import type { Signal, GroupRef } from '../../../types';

export default function AdminSignalsScreen() {
  const insets = useSafeAreaInsets();
  const [exporting, setExporting] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [insightsSignalId, setInsightsSignalId] = useState<number | null>(null);
  const [audienceModalData, setAudienceModalData] = useState<{ groups: GroupRef[]; title?: string } | null>(null);
  const [visibleSignals, setVisibleSignals] = useState<Signal[]>([]);

  const instruments = visibleSignals.map((s) => ({
    segment: s.exchange_segment,
    security_id: s.security_id,
  }));
  const { getLtp } = useLiveLtp(instruments);

  useFocusEffect(
    useCallback(() => {
      setRefreshNonce((value: number) => value + 1);
    }, []),
  );

  const handleExportOrders = () => {
    setExportModalVisible(true);
  };

  const handleExportConfirm = async (dateFrom: string | null, dateTo: string | null) => {
    if (!dateFrom || !dateTo) {
      Alert.alert('Select both dates', 'Choose a start and end date before exporting.');
      return;
    }
    if (dateFrom > dateTo) {
      Alert.alert('Invalid range', 'From date must be earlier than or equal to To date.');
      return;
    }
    setExportModalVisible(false);
    setExporting(true);
    try {
      await adminApi.exportOrders({ date_from: dateFrom, date_to: dateTo });
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
    const currentLifecycle = s.lifecycle ?? s.status;
    const pendingCount = s.pending_count ?? Math.max(0, (s.total_notified ?? 0) - (s.placed ?? 0) - (s.rejected ?? 0) - (s.failed ?? 0) - (s.confirmed ?? 0));
    const canCancelSignal = (currentLifecycle === 'awaiting' || (!s.lifecycle && s.status === 'active')) && pendingCount > 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push({ pathname: '/(admin)/signal/[id]', params: { id: s.id } })}
        activeOpacity={0.8}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardTopLeft}>
            <View style={[styles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
              <Text style={[styles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>{s.transaction_type}</Text>
            </View>
            <AudienceBadge
              targetGroupIds={s.target_group_ids}
              targetGroups={s.target_groups}
              onPressGroups={(groups) => setAudienceModalData({ groups, title: s.title })}
              size="sm"
            />
          </View>
          <StatusBadge status={currentLifecycle} size="sm" />
        </View>

        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.meta}>{s.exchange_segment} · Security {s.security_id} · Qty {s.quantity}</Text>

        {s.total_notified !== undefined && (
          <View style={styles.progress}>
            <ProgressPill label="Notified" value={s.total_notified} color={Colors.primary} />
            <ProgressPill label="Submitted" value={s.placed ?? 0} color={Colors.success} />
            <ProgressPill label="Pending" value={pendingCount} color={Colors.warning} />
            <ProgressPill label="Failed" value={s.failed ?? 0} color={Colors.error} />
          </View>
        )}

        <SignalPriceBar
          entryPrice={s.price}
          targetPrice={s.target_price}
          stopLossPrice={s.stop_loss_price}
          transactionType={s.transaction_type}
          currentPrice={getLtp(s.exchange_segment, s.security_id)}
          variant="compact"
        />

        <View style={styles.cardFooter}>
          <Text style={styles.timeText}>{formatDateTimeIST(s.created_at)}</Text>
          <View style={styles.cardFooterRight}>
            {currentLifecycle === 'completed' && (
              <TouchableOpacity
                style={styles.insightsBtn}
                onPress={() => setInsightsSignalId(s.id)}
                activeOpacity={0.8}
              >
                <Feather name="bar-chart-2" size={12} color={Colors.primary} />
                <Text style={styles.insightsBtnText}>Insights</Text>
              </TouchableOpacity>
            )}
            {canCancelSignal && (
              <TouchableOpacity onPress={() => handleCancel(s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <TradeInsightsModal
        visible={insightsSignalId != null}
        signalId={insightsSignalId}
        isAdmin
        onClose={() => setInsightsSignalId(null)}
      />

      <AudienceGroupsModal
        visible={audienceModalData != null}
        groups={audienceModalData?.groups ?? []}
        signalTitle={audienceModalData?.title}
        onClose={() => setAudienceModalData(null)}
      />

      <ExportDateRangeModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        onSubmit={handleExportConfirm}
      />

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
        itemTypeLabel="signal"
        fetchDays={({ page, pageSize }) => adminApi.getSignalDays({ page, pageSize })}
        fetchItemsForDay={({ date, page, pageSize }) => adminApi.getSignals({ page, pageSize, date_from: date, date_to: date })}
        renderItem={renderItem}
        keyExtractor={(s) => String(s.id)}
        onVisibleItemsChange={setVisibleSignals}
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
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.xs },
  cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  txBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full },
  txText: { fontSize: 12, fontWeight: '800' },
  title: { ...Typography.h3 },
  meta: { ...Typography.caption },
  progress: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: Colors.background, borderRadius: Radius.sm, paddingVertical: 8,
  },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeText: { ...Typography.caption },
  cancelLink: { fontSize: 13, color: Colors.error, fontWeight: '700' },
  insightsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  insightsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
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

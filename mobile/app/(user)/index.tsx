import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Modal,
  TouchableOpacity, RefreshControl, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { userApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateTimeIST } from '../../utils/time';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import Pagination from '../../components/Pagination';
import DateRangeFilter from '../../components/DateRangeFilter';
import type { SignalNotification, PaginationMeta } from '../../types';

const QTY_PRESETS = [5, 15, 20, 25, 30];

/** Returns the quantity for N lots given a lot_size, or N directly if lot_size unknown */
function lotsToQty(lots: number, lotSize: number | null): number {
  return lotSize != null && lotSize > 0 ? lots * lotSize : lots;
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<SignalNotification[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  // Quantity picker modal state
  const [qtyModal, setQtyModal] = useState<{ notification: SignalNotification } | null>(null);
  const [customQty, setCustomQty] = useState('');
  const [selectedQty, setSelectedQty] = useState<number | null>(null);

  const load = useCallback(async (showError = true) => {
    try {
      const data = await userApi.getNotifications({ page, date_from: dateFrom, date_to: dateTo });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err: any) {
      if (showError) {
        Alert.alert('Error', err.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, dateFrom, dateTo]);

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

  const handleDateChange = (from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const handleConfirm = (n: SignalNotification) => {
    const lotSize = n.signal.lot_size ?? null;
    // Default selection = admin's lot count (so button shows correctly highlighted)
    const defaultLots = lotSize ? Math.round(n.signal.quantity / lotSize) : n.signal.quantity;
    setSelectedQty(defaultLots);
    setCustomQty('');
    setQtyModal({ notification: n });
  };

  const handlePlaceOrder = async () => {
    if (!qtyModal) return;
    const n = qtyModal.notification;
    const lotSize = n.signal.lot_size ?? null;
    const finalQty = customQty.trim()
      ? parseInt(customQty.trim(), 10)
      : selectedQty != null ? lotsToQty(selectedQty, lotSize) : null;
    if (!finalQty || isNaN(finalQty) || finalQty < 1) {
      Alert.alert('Invalid quantity', 'Please select or enter a valid quantity.');
      return;
    }
    setQtyModal(null);
    setActionId(n.id);
    try {
      const updated = await userApi.confirmNotification(
        n.id,
        finalQty !== n.signal.quantity ? finalQty : undefined,
      );
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      if (updated.status === 'placed') {
        Alert.alert('✅ Order Placed', `Qty: ${finalQty} · Dhan Order ID: ${updated.dhan_order_id ?? 'N/A'}`);
      } else {
        Alert.alert('❌ Order Failed', updated.error_message ?? 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionId(null);
    }
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

        <Text style={styles.time}>{formatDateTimeIST(n.created_at)}</Text>
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

      <View style={styles.filterBar}>
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
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

      <Pagination meta={meta} onPageChange={setPage} loading={loading} />

      {/* ── Quantity picker modal ───────────────────────────────────────── */}
      <Modal visible={!!qtyModal} transparent animationType="slide" onRequestClose={() => setQtyModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {qtyModal && (() => {
              const n = qtyModal.notification;
              const isBuy = n.signal.transaction_type === 'BUY';
              const lotSize = n.signal.lot_size ?? null;
              // Admin's quantity expressed in lots (or raw if no lot_size)
              const adminLots = lotSize ? Math.round(n.signal.quantity / lotSize) : n.signal.quantity;
              // Build deduplicated sorted preset list (in lots)
              const lotPresets = [...QTY_PRESETS, adminLots]
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort((a, b) => a - b);

              const effectiveQty = customQty.trim()
                ? parseInt(customQty.trim(), 10)
                : selectedQty != null ? lotsToQty(selectedQty, lotSize) : null;

              return (
                <>
                  <Text style={styles.modalTitle}>{n.signal.title}</Text>
                  <Text style={styles.modalSub}>
                    {n.signal.transaction_type} · {n.signal.exchange_segment} · Entry ₹{n.signal.price}
                    {lotSize ? `  ·  Lot size: ${lotSize}` : ''}
                  </Text>

                  <Text style={styles.qtyLabel}>
                    {lotSize ? 'Select Lots' : 'Select Quantity'}
                  </Text>

                  {/* Preset buttons (show lots; show actual qty below) */}
                  <View style={styles.presets}>
                    {lotPresets.map((lots) => {
                      const qty = lotsToQty(lots, lotSize);
                      const isAdmin = lots === adminLots;
                      const isActive = selectedQty === lots && !customQty;
                      return (
                        <TouchableOpacity
                          key={lots}
                          style={[
                            styles.presetBtn,
                            isActive && styles.presetBtnActive,
                            isAdmin && !isActive && styles.presetBtnAdmin,
                          ]}
                          onPress={() => { setSelectedQty(lots); setCustomQty(''); }}
                        >
                          <Text style={[styles.presetText, isActive && styles.presetTextActive]}>
                            {lotSize ? `${lots} lots` : lots}
                            {'\n'}
                            <Text style={{ fontSize: 10 }}>
                              {lotSize ? `(${qty})` : ''}{isAdmin ? ' admin' : ''}
                            </Text>
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Custom input — always raw quantity */}
                  <View style={styles.customRow}>
                    <Text style={styles.customLabel}>Custom qty:</Text>
                    <TextInput
                      style={[styles.customInput, customQty ? styles.customInputActive : null]}
                      value={customQty}
                      onChangeText={(v) => { setCustomQty(v.replace(/[^0-9]/g, '')); setSelectedQty(null); }}
                      placeholder={`e.g. ${lotsToQty(1, lotSize)}`}
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="numeric"
                    />
                  </View>

                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setQtyModal(null)}>
                      <Text style={styles.modalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalConfirmBtn, { backgroundColor: isBuy ? Colors.buy : Colors.sell }]}
                      onPress={handlePlaceOrder}
                    >
                      <Text style={styles.modalConfirmText}>
                        Place {n.signal.transaction_type} · Qty {effectiveQty ?? '—'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
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
  filterBar: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
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

  // Quantity picker modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.lg, paddingBottom: 32, gap: Spacing.md,
  },
  modalTitle: { ...Typography.h3 },
  modalSub: { ...Typography.bodySmall, marginTop: -8 },
  qtyLabel: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: -4 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.sm,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', minWidth: 56,
  },
  presetBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  presetBtnAdmin: { borderColor: Colors.primaryLight, borderStyle: 'dashed' },
  presetBtnAdminActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  presetText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },
  presetTextActive: { color: '#fff' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  customLabel: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5, width: 64 },
  customInput: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: 15, color: Colors.text,
  },
  customInputActive: { borderColor: Colors.primary },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  modalCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: Radius.sm, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  modalConfirmBtn: {
    flex: 2, paddingVertical: 13, borderRadius: Radius.sm, alignItems: 'center',
  },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

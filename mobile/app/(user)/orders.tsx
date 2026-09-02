import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, ActivityIndicator, TouchableOpacity, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { userApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateTimeIST } from '../../utils/time';
import StatusBadge from '../../components/StatusBadge';
import LiveStatusBadge from '../../components/LiveStatusBadge';
import OrderTimeline from '../../components/OrderTimeline';
import EmptyState from '../../components/EmptyState';
import Pagination from '../../components/Pagination';
import DateRangeFilter from '../../components/DateRangeFilter';
import CreditsHeader from '../../components/CreditsHeader';
import type { SignalNotification, PaginationMeta, OrderEvent } from '../../types';

export default function OrdersScreen() {
  const [orders, setOrders] = useState<SignalNotification[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Timeline modal state
  const [selectedNotifId, setSelectedNotifId] = useState<number | null>(null);
  const [selectedOrderTitle, setSelectedOrderTitle] = useState<string>('');
  const [timelineEvents, setTimelineEvents] = useState<OrderEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await userApi.getOrders({ page, date_from: dateFrom, date_to: dateTo });
      setOrders(data.items);
      setMeta(data.meta);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [page, dateFrom, dateTo]);

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

  const handleDateChange = (from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const openTimeline = async (o: SignalNotification) => {
    setSelectedNotifId(o.id);
    setSelectedOrderTitle(o.signal.title);
    setTimelineLoading(true);
    setTimelineEvents([]);
    try {
      const events = await userApi.getNotificationEvents(o.id);
      setTimelineEvents(events);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  const renderItem = ({ item: o }: { item: SignalNotification }) => {
    const isBuy = o.signal.transaction_type === 'BUY';
    const isExpiredUnfilled = o.status === 'failed' && o.live_status === 'CANCELLED'
      && (!o.reason_description || o.reason_description.toUpperCase() === 'CONFIRMED');
    const pnl = o.realized_pnl;

    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.txBadge, { backgroundColor: isBuy ? Colors.buyBg : Colors.sellBg }]}>
              <Text style={[styles.txText, { color: isBuy ? Colors.buy : Colors.sell }]}>
                {o.signal.transaction_type}
              </Text>
            </View>
            {o.is_auto_placed && (
              <View style={styles.autoBadge}>
                <Text style={styles.autoBadgeText}>AUTO</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {pnl != null && (
              <View style={[styles.pnlBadge, { backgroundColor: pnl >= 0 ? Colors.successBg : Colors.errorBg }]}>
                <Text style={[styles.pnlText, { color: pnl >= 0 ? Colors.success : Colors.error }]}>
                  {pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`}
                </Text>
              </View>
            )}
            {o.live_status ? (
              <LiveStatusBadge liveStatus={o.live_status} size="sm" />
            ) : o.status === 'failed' ? (
              <StatusBadge status="failed" size="sm" />
            ) : (
              <StatusBadge status="confirmed" size="sm" />
            )}
          </View>
        </View>

        <Text style={styles.title}>{o.signal.title}</Text>
        <Text style={styles.meta}>
          {o.signal.exchange_segment} · {o.signal.security_id} · Qty {o.ordered_quantity ?? o.signal.quantity}
        </Text>

        <View style={styles.priceRow}>
          <Text style={styles.price}>Entry ₹{o.signal.price}</Text>
          <Text style={[styles.price, { color: Colors.error }]}>SL ₹{o.signal.stop_loss_price}</Text>
          <Text style={[styles.price, { color: Colors.success }]}>Target ₹{o.signal.target_price}</Text>
        </View>

        {(o.status === 'placed' || !!o.live_status) && (
          <View style={[styles.resultBox, (o.live_status === 'REJECTED' || (o.status === 'failed' && !isExpiredUnfilled)) ? { backgroundColor: Colors.errorBg } : null]}>
            {o.dhan_order_id && <Text style={styles.successText}>✅ Order ID: {o.dhan_order_id}</Text>}
            {o.placed_at && <Text style={styles.timeText}>Submitted at {formatDateTimeIST(o.placed_at)}</Text>}
            {o.live_status === 'TRADED' && o.traded_price != null && (
              <Text style={styles.timeText}>Filled @ ₹{o.traded_price.toFixed(2)} × {o.traded_qty ?? 0}</Text>
            )}
            {o.exit_leg && o.exit_price != null && (
              <Text style={[styles.timeText, { color: o.exit_leg === 'TARGET_LEG' ? Colors.success : Colors.error, fontWeight: '700' }]}>
                🎯 Exit via {o.exit_leg} @ ₹{o.exit_price.toFixed(2)}
              </Text>
            )}
            {o.live_status === 'REJECTED' && o.reason_description && (
              <Text style={styles.timeText}>{o.reason_description}</Text>
            )}
            {!o.live_status && <Text style={styles.timeText}>Awaiting live Dhan confirmation</Text>}
          </View>
        )}

        {o.status === 'failed' && (
          <View style={[styles.resultBox, isExpiredUnfilled ? null : { backgroundColor: Colors.errorBg }]}>
            {isExpiredUnfilled
              ? <Text style={styles.timeText}>⏱️ Order expired unfilled — entry price was never hit</Text>
              : <Text style={styles.errorText}>❌ {o.error_message ?? 'Order failed'}</Text>}
          </View>
        )}

        {/* Timeline trigger */}
        <TouchableOpacity style={styles.timelineBtn} onPress={() => openTimeline(o)}>
          <Feather name="clock" size={14} color={Colors.primary} />
          <Text style={styles.timelineBtnText}>View Live Timeline</Text>
        </TouchableOpacity>
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
      <CreditsHeader />
      <View style={styles.headerBar}>
        <Text style={styles.pageTitle}>Order History</Text>
        <Text style={styles.count}>{meta?.total ?? orders.length} orders</Text>
      </View>

      <View style={styles.filterBar}>
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
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

      <Pagination meta={meta} onPageChange={setPage} loading={loading} />

      {/* Timeline Modal */}
      <Modal visible={selectedNotifId != null} animationType="slide" transparent onRequestClose={() => setSelectedNotifId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Order Live Events</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>{selectedOrderTitle}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedNotifId(null)} style={styles.closeBtn}>
                <Feather name="x" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={[]}
              renderItem={null}
              ListHeaderComponent={<OrderTimeline events={timelineEvents} loading={timelineLoading} />}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: Spacing.xl }}
            />
          </View>
        </View>
      </Modal>
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
  filterBar: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
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
  autoBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: Colors.primaryBg },
  autoBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.primary, letterSpacing: 0.5 },
  pnlBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.sm },
  pnlText: { fontSize: 12, fontWeight: '800' },
  title: { ...Typography.h3 },
  meta: { ...Typography.caption },
  priceRow: { flexDirection: 'row', gap: Spacing.md },
  price: { fontSize: 13, fontWeight: '600', color: Colors.text },
  resultBox: { backgroundColor: Colors.successBg, borderRadius: Radius.sm, padding: Spacing.sm, gap: 2 },
  successText: { fontSize: 13, color: Colors.success, fontWeight: '600' },
  errorText: { fontSize: 13, color: Colors.error, fontWeight: '600' },
  timeText: { fontSize: 11, color: Colors.textMuted },
  timelineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, backgroundColor: Colors.primaryBg, borderRadius: Radius.sm, marginTop: 4,
  },
  timelineBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    maxHeight: '80%',
    padding: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { ...Typography.h3 },
  modalSubtitle: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: { padding: Spacing.xs },
});

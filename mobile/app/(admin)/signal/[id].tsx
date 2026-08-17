import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, Pressable, ScrollView, Animated, Easing, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';
import { formatDateTimeIST } from '../../../utils/time';
import StatusBadge from '../../../components/StatusBadge';
import LiveStatusBadge from '../../../components/LiveStatusBadge';
import Pagination from '../../../components/Pagination';
import OrderTimeline from '../../../components/OrderTimeline';
import type {
  Signal, AdminSignalNotificationRow, AdminSignalNotificationsResponse,
  SignalOrderModifyPayload, OrderActionResult, OrderEvent,
} from '../../../types';

const STATUS_FILTERS = ['all', 'placed', 'pending', 'failed', 'cancelled', 'rejected'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const ACTIVE_LIVE = new Set(['TRANSIT', 'PENDING', 'PART_TRADED']);
const TERMINAL_LIVE = new Set(['TRADED', 'EXPIRED', 'CANCELLED', 'REJECTED']);

export default function SignalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [signal, setSignal] = useState<Signal | null>(null);
  const [notifPage, setNotifPage] = useState<AdminSignalNotificationsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Detail modal
  const [selectedNotif, setSelectedNotif] = useState<AdminSignalNotificationRow | null>(null);
  const [notifEvents, setNotifEvents] = useState<OrderEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const animOpacity = useRef(new Animated.Value(0)).current;
  const animScale  = useRef(new Animated.Value(0.88)).current;

  // Modify modal
  const [modifyVisible, setModifyVisible] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<number | null>(null); // null = bulk
  const [modifyForm, setModifyForm] = useState({ price: '', target_price: '', stop_loss_price: '', trailing_jump: '' });

  const loadSignal = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await adminApi.getSignal(Number(id));
      setSignal(detail.signal);
    } catch {}
  }, [id]);

  const loadNotifications = useCallback(async (p: number, filter: StatusFilter) => {
    if (!id) return;
    try {
      const res = await adminApi.getSignalNotifications(Number(id), {
        page: p,
        pageSize: 20,
        status: filter === 'all' ? undefined : filter,
      });
      setNotifPage(res);
    } catch {}
  }, [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSignal(), loadNotifications(page, statusFilter)])
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadNotifications(page, statusFilter);
  }, [page, statusFilter]);

  const openModal = (notif: AdminSignalNotificationRow) => {
    setSelectedNotif(notif);
    setNotifEvents([]);
    setEventsLoading(true);
    setModalVisible(true);
    animOpacity.setValue(0); animScale.setValue(0.88);
    Animated.parallel([
      Animated.timing(animOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(animScale, { toValue: 1, damping: 18, stiffness: 280, useNativeDriver: true }),
    ]).start();

    adminApi.getNotificationEvents(notif.notification_id)
      .then(setNotifEvents)
      .catch(() => setNotifEvents([]))
      .finally(() => setEventsLoading(false));
  };

  const closeModal = () => {
    Animated.parallel([
      Animated.timing(animOpacity, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(animScale, { toValue: 0.88, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => { setModalVisible(false); setSelectedNotif(null); setNotifEvents([]); });
  };

  const openModify = (notifId: number | null) => {
    const s = signal;
    setModifyTarget(notifId);
    setModifyForm({
      price: s ? String(s.price) : '',
      target_price: s ? String(s.target_price) : '',
      stop_loss_price: s ? String(s.stop_loss_price) : '',
      trailing_jump: s ? String(s.trailing_jump) : '',
    });
    setModifyVisible(true);
  };

  const handleCancelAll = () => {
    Alert.alert(
      'Cancel All Orders',
      'This will cancel all active placed orders for this signal. Are you sure?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancel All', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const results: OrderActionResult[] = await adminApi.cancelSignalOrders(Number(id));
              const ok = results.filter(r => r.success).length;
              const fail = results.length - ok;
              Alert.alert('Done', `Cancelled: ${ok} order(s). Failed: ${fail}.`);
              await Promise.all([loadSignal(), loadNotifications(page, statusFilter)]);
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Unknown error');
            } finally { setActionLoading(false); }
          },
        },
      ],
    );
  };

  const handleCancelOne = async (notif: AdminSignalNotificationRow) => {
    Alert.alert(
      'Cancel Order',
      `Cancel order for ${notif.user_name}?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancel', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const r = await adminApi.cancelNotificationOrder(notif.notification_id);
              Alert.alert(r.success ? 'Cancelled' : 'Failed', r.success ? 'Order cancelled.' : (r.reason ?? 'Unknown'));
              await Promise.all([loadSignal(), loadNotifications(page, statusFilter)]);
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally { setActionLoading(false); }
          },
        },
      ],
    );
  };

  const handleSubmitModify = async () => {
    const payload: SignalOrderModifyPayload = {};
    if (modifyForm.price) payload.price = parseFloat(modifyForm.price);
    if (modifyForm.target_price) payload.target_price = parseFloat(modifyForm.target_price);
    if (modifyForm.stop_loss_price) payload.stop_loss_price = parseFloat(modifyForm.stop_loss_price);
    if (modifyForm.trailing_jump) payload.trailing_jump = parseFloat(modifyForm.trailing_jump);

    setModifyVisible(false);
    setActionLoading(true);
    try {
      if (modifyTarget !== null) {
        const r = await adminApi.modifyNotificationOrder(modifyTarget, payload);
        Alert.alert(r.success ? 'Modified' : 'Failed', r.success ? 'Order modified.' : (r.reason ?? 'Unknown'));
      } else {
        const results = await adminApi.modifySignalOrders(Number(id), payload);
        const ok = results.filter(r => r.success).length;
        Alert.alert('Done', `Modified: ${ok}/${results.length} order(s).`);
      }
      await Promise.all([loadSignal(), loadNotifications(page, statusFilter)]);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setActionLoading(false); }
  };

  const hasActivePlaced = (notifPage?.items ?? []).some(
    (n: AdminSignalNotificationRow) => n.status === 'placed' && !TERMINAL_LIVE.has(n.live_status ?? '')
  );

  const renderRow = ({ item: n }: { item: AdminSignalNotificationRow }) => {
    const isActivePlaced = n.status === 'placed' && !TERMINAL_LIVE.has(n.live_status ?? '');
    return (
      <TouchableOpacity style={styles.row} onPress={() => openModal(n)} activeOpacity={0.75}>
        <View style={styles.rowLeft}>
          <Text style={styles.userName}>{n.user_name}</Text>
          <Text style={styles.userEmail}>{n.user_email}</Text>
          {n.assigned_ipv6 && <Text style={styles.ipText}>{n.assigned_ipv6}</Text>}
          {n.placed_at && <Text style={styles.timeSmall}>{formatDateTimeIST(n.placed_at)}</Text>}
        </View>
        <View style={styles.rowRight}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {n.realized_pnl != null && (
              <View style={[styles.pnlBadge, { backgroundColor: n.realized_pnl >= 0 ? Colors.successBg : Colors.errorBg }]}>
                <Text style={[styles.pnlText, { color: n.realized_pnl >= 0 ? Colors.success : Colors.error }]}>
                  {n.realized_pnl >= 0 ? `+₹${n.realized_pnl.toFixed(2)}` : `-₹${Math.abs(n.realized_pnl).toFixed(2)}`}
                </Text>
              </View>
            )}
            {n.status === 'placed'
              ? (n.live_status ? <LiveStatusBadge liveStatus={n.live_status} size="sm" /> : <Text style={styles.awaitingText}>Awaiting</Text>)
              : <StatusBadge status={n.status} size="sm" />}
          </View>
          {n.traded_price != null && n.traded_price > 0 && (
            <Text style={styles.fillText}>₹{n.traded_price} × {n.traded_qty ?? 0}</Text>
          )}
          {n.exit_leg && (
            <Text style={[styles.exitTag, { color: n.exit_leg === 'TARGET_LEG' ? Colors.success : Colors.error }]}>
              {n.exit_leg === 'TARGET_LEG' ? '🎯 Target' : '🛑 SL'}
            </Text>
          )}
          {isActivePlaced && (
            <View style={styles.rowActions}>
              <TouchableOpacity style={styles.rowActionBtn} onPress={() => handleCancelOne(n)}>
                <Text style={styles.rowActionCancel}>✕ Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rowActionBtn} onPress={() => { closeModal(); openModify(n.notification_id); }}>
                <Text style={styles.rowActionModify}>✎ Modify</Text>
              </TouchableOpacity>
            </View>
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
  if (!signal) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text>Signal not found.</Text></View>
      </SafeAreaView>
    );
  }

  const totalNotifs = notifPage?.meta.total ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle} numberOfLines={1}>Signal #{signal.id}</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={notifPage?.items ?? []}
        keyExtractor={(n: AdminSignalNotificationRow) => String(n.notification_id)}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            {/* Signal card */}
            <View style={styles.signalCard}>
              <View style={styles.signalTop}>
                <Text style={styles.signalTitle}>{signal.title}</Text>
                <StatusBadge status={signal.status} />
              </View>
              <Text style={styles.signalMeta}>
                {signal.transaction_type} · {signal.quantity}{signal.lot_size ? ` (lot: ${signal.lot_size})` : ''} · {signal.exchange_segment} / {signal.security_id}
              </Text>
              <View style={styles.priceRow}>
                <PriceChip label="Entry" value={`₹${signal.price}`} />
                <PriceChip label="SL" value={`₹${signal.stop_loss_price}`} color={Colors.error} />
                <PriceChip label="Target" value={`₹${signal.target_price}`} color={Colors.success} />
                {signal.trailing_jump > 0 && <PriceChip label="Trail" value={`₹${signal.trailing_jump}`} />}
              </View>
              <Text style={styles.timeText}>{formatDateTimeIST(signal.created_at)}</Text>
            </View>

            {/* Bulk actions */}
            {signal.status === 'active' && (
              <View style={styles.actionsBar}>
                {hasActivePlaced && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.cancelAllBtn, actionLoading && { opacity: 0.5 }]}
                    onPress={handleCancelAll}
                    disabled={actionLoading}
                  >
                    {actionLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.cancelAllText}>✕ Cancel All Orders</Text>}
                  </TouchableOpacity>
                )}
                {hasActivePlaced && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.modifyBtn, actionLoading && { opacity: 0.5 }]}
                    onPress={() => openModify(null)}
                    disabled={actionLoading}
                  >
                    <Text style={styles.modifyBtnText}>✎ Modify All</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Exchange summary */}
            {signal.placed != null && signal.placed > 0 && (
              <View style={styles.summaryRow}>
                <SummaryCell label="Notified" value={signal.total_notified ?? 0} />
                <SummaryCell label="Placed" value={signal.placed} color={Colors.primary} />
                <SummaryCell label="Live ✓" value={signal.exchange_confirmed ?? 0} color={Colors.success} />
                <SummaryCell label="Awaiting" value={signal.awaiting_confirmation ?? 0} color={Colors.info} />
                <SummaryCell label="Rejected" value={signal.exchange_rejected ?? 0} color={Colors.error} />
              </View>
            )}

            {/* Status filter tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar}>
              {STATUS_FILTERS.map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterTab, statusFilter === f && styles.filterTabActive]}
                  onPress={() => { setStatusFilter(f); setPage(1); }}
                >
                  <Text style={[styles.filterTabText, statusFilter === f && styles.filterTabTextActive]}>
                    {f === 'all' ? `All (${totalNotifs})` : f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        ListFooterComponent={() => notifPage && notifPage.meta.total_pages > 1 ? (
          <View style={{ paddingVertical: Spacing.md }}>
            <Pagination
              meta={notifPage.meta}
              onPageChange={setPage}
            />
          </View>
        ) : null}
        contentContainerStyle={styles.list}
      />

      {/* ── Detail modal ─────────────────────────────────────────────── */}
      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={closeModal}>
        <Animated.View style={[styles.backdrop, { opacity: animOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
          <Animated.View style={[styles.modalCard, { transform: [{ scale: animScale }] }]} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalName}>{selectedNotif?.user_name}</Text>
                <Text style={styles.modalEmail}>{selectedNotif?.user_email}</Text>
              </View>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
              <View style={styles.modalStatusRow}>
                {selectedNotif?.status === 'placed'
                  ? (selectedNotif.live_status ? <LiveStatusBadge liveStatus={selectedNotif.live_status} /> : <Text style={styles.awaitingText}>Awaiting live status</Text>)
                  : <StatusBadge status={selectedNotif?.status ?? ''} />}
              </View>

              {/* Order IDs */}
              {selectedNotif?.dhan_order_id && <ModalRow label="Order ID" value={selectedNotif.dhan_order_id} mono selectable />}
              {selectedNotif?.exchange_order_no && <ModalRow label="Exchange No" value={selectedNotif.exchange_order_no} mono selectable />}

              {/* Quantity — flag if user deviated from signal quantity */}
              {selectedNotif?.ordered_quantity != null && (() => {
                const deviated = signal && selectedNotif.ordered_quantity !== signal.quantity;
                return (
                  <ModalRow
                    label="Ordered Qty"
                    value={deviated
                      ? `${selectedNotif.ordered_quantity} ⚠️ (signal: ${signal?.quantity})`
                      : String(selectedNotif.ordered_quantity)}
                    highlight={deviated ? Colors.warning : undefined}
                  />
                );
              })()}

              {/* Entry fill */}
              {selectedNotif?.traded_price != null && selectedNotif.traded_price > 0 && (
                <ModalRow label="Entry Fill" value={`₹${selectedNotif.traded_price} × ${selectedNotif.traded_qty ?? 0} qty`} highlight={Colors.success} />
              )}

              {/* Exit */}
              {selectedNotif?.exit_leg && (
                <>
                  <View style={styles.modalDivider} />
                  <ModalRow label="Exit Via" value={selectedNotif.exit_leg === 'TARGET_LEG' ? '🎯 Target Hit' : '🛑 Stop-Loss Hit'}
                    highlight={selectedNotif.exit_leg === 'TARGET_LEG' ? Colors.success : Colors.error} />
                  {selectedNotif.exit_price != null && <ModalRow label="Exit Price" value={`₹${selectedNotif.exit_price.toFixed(2)}`} highlight={selectedNotif.exit_leg === 'TARGET_LEG' ? Colors.success : Colors.error} />}
                  {selectedNotif.exit_time && <ModalRow label="Exit Time" value={formatDateTimeIST(selectedNotif.exit_time)} />}
                  {selectedNotif.realized_pnl != null && (
                    <ModalRow
                      label="Realized P&L"
                      value={selectedNotif.realized_pnl >= 0 ? `+₹${selectedNotif.realized_pnl.toFixed(2)}` : `-₹${Math.abs(selectedNotif.realized_pnl).toFixed(2)}`}
                      highlight={selectedNotif.realized_pnl >= 0 ? Colors.success : Colors.error}
                    />
                  )}
                </>
              )}

              {/* Error / rejection */}
              {selectedNotif?.reason_description && <ModalRow label="Reason" value={selectedNotif.reason_description} />}
              {selectedNotif?.error_message && (
                <View style={styles.modalErrorBox}>
                  <Text style={styles.modalErrorLabel}>Error</Text>
                  <Text style={styles.modalErrorText} selectable>{selectedNotif.error_message}</Text>
                </View>
              )}

              {/* Real-time Event Timeline */}
              <View style={styles.modalDivider} />
              <Text style={styles.timelineTitle}>Live Order Events</Text>
              <OrderTimeline events={notifEvents} loading={eventsLoading} />

              <View style={styles.modalDivider} />
              <Text style={styles.timelineTitle}>Timestamps</Text>
              <ModalRow label="Received" value={formatDateTimeIST(selectedNotif?.created_at)} />
              {selectedNotif?.confirmed_at && <ModalRow label="Confirmed" value={formatDateTimeIST(selectedNotif.confirmed_at)} />}
              {selectedNotif?.placed_at && <ModalRow label="Submitted" value={formatDateTimeIST(selectedNotif.placed_at)} highlight={Colors.success} />}
              {selectedNotif?.live_updated_at && <ModalRow label="Last Exchange Update" value={formatDateTimeIST(selectedNotif.live_updated_at)} />}

              {selectedNotif?.assigned_ipv6 && <ModalRow label="IPv6" value={selectedNotif.assigned_ipv6} mono selectable />}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* ── Modify modal ─────────────────────────────────────────────── */}
      <Modal visible={modifyVisible} transparent animationType="slide" onRequestClose={() => setModifyVisible(false)}>
        <Pressable style={styles.modifyBackdrop} onPress={() => setModifyVisible(false)} />
        <View style={styles.modifySheet}>
          <Text style={styles.modifyTitle}>
            {modifyTarget !== null ? 'Modify Order' : 'Modify All Orders'}
          </Text>
          <Text style={styles.modifySubtitle}>Leave a field blank to keep its current value.</Text>
          <ModifyField label="Entry Price (PENDING only)" value={modifyForm.price} onChangeText={(v) => setModifyForm((f: typeof modifyForm) => ({ ...f, price: v }))} />
          <ModifyField label="Target Price" value={modifyForm.target_price} onChangeText={(v) => setModifyForm((f: typeof modifyForm) => ({ ...f, target_price: v }))} />
          <ModifyField label="Stop-Loss Price" value={modifyForm.stop_loss_price} onChangeText={(v) => setModifyForm((f: typeof modifyForm) => ({ ...f, stop_loss_price: v }))} />
          <ModifyField label="Trailing Jump" value={modifyForm.trailing_jump} onChangeText={(v) => setModifyForm((f: typeof modifyForm) => ({ ...f, trailing_jump: v }))} />
          <View style={styles.modifyActions}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setModifyVisible(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modifySubmitBtn} onPress={handleSubmitModify}>
              <Text style={styles.modifySubmitText}>Confirm Modify</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function PriceChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 10, color: Colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: '700', color: color ?? Colors.text }}>{value}</Text>
    </View>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: color ?? Colors.text }}>{value}</Text>
      <Text style={{ fontSize: 9, color: Colors.textMuted, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function ModalRow({ label, value, mono, selectable, highlight }: { label: string; value?: string | null; mono?: boolean; selectable?: boolean; highlight?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5, gap: Spacing.sm }}>
      <Text style={{ fontSize: 12, color: Colors.textMuted, flex: 1 }}>{label}</Text>
      <Text
        style={{ fontSize: mono ? 12 : 13, fontFamily: mono ? 'monospace' : undefined, color: highlight ?? Colors.text, fontWeight: '500', flex: 2, textAlign: 'right' }}
        selectable={selectable}
      >{value ?? '—'}</Text>
    </View>
  );
}

function ModifyField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={{ marginBottom: Spacing.sm }}>
      <Text style={{ fontSize: 12, color: Colors.textMuted, marginBottom: 4 }}>{label}</Text>
      <TextInput
        style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: 14, color: Colors.text }}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder="Unchanged"
        placeholderTextColor={Colors.textMuted}
      />
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
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600', width: 60 },
  pageTitle: { ...Typography.h3, flex: 1, textAlign: 'center' },
  list: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  signalCard: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card, gap: 8 },
  signalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  signalTitle: { ...Typography.h3, flex: 1, marginRight: 8 },
  signalMeta: { ...Typography.bodySmall },
  priceRow: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: Radius.sm, paddingVertical: 8 },
  timeText: { ...Typography.caption },
  actionsBar: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1, paddingVertical: 11, borderRadius: Radius.sm, alignItems: 'center' },
  cancelAllBtn: { backgroundColor: Colors.error },
  cancelAllText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  modifyBtn: { backgroundColor: Colors.primaryBg, borderWidth: 1.5, borderColor: Colors.primary },
  modifyBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  summaryRow: {
    flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: Radius.sm,
    padding: Spacing.md, ...Shadow.card, justifyContent: 'space-around',
  },
  filterBar: { flexGrow: 0, marginBottom: 4 },
  filterTab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full,
    backgroundColor: Colors.surface, marginRight: 8, borderWidth: 1.5, borderColor: Colors.border,
  },
  filterTabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTabText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  filterTabTextActive: { color: '#fff' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: Colors.surface, borderRadius: Radius.sm, padding: Spacing.md, ...Shadow.card,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4, maxWidth: '50%' },
  userName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.textSecondary },
  ipText: { fontSize: 11, fontFamily: 'monospace', color: Colors.info },
  timeSmall: { fontSize: 11, color: Colors.textMuted },
  awaitingText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  fillText: { fontSize: 12, color: Colors.success, fontWeight: '600' },  pnlBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  pnlText: { fontSize: 11, fontWeight: '800' },  exitTag: { fontSize: 12, fontWeight: '700' },
  rowActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  rowActionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border },
  rowActionCancel: { fontSize: 11, color: Colors.error, fontWeight: '700' },
  rowActionModify: { fontSize: 11, color: Colors.primary, fontWeight: '700' },

  // Detail modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  modalCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', ...Shadow.card },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  modalName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  modalEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: { fontSize: 18, color: Colors.textMuted, fontWeight: '600', paddingLeft: Spacing.sm },
  modalStatusRow: { alignItems: 'flex-start', marginBottom: Spacing.md },
  modalDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  timelineTitle: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  modalErrorBox: { backgroundColor: Colors.errorBg, borderRadius: Radius.sm, padding: Spacing.sm, marginVertical: Spacing.sm },
  modalErrorLabel: { fontSize: 11, color: Colors.error, fontWeight: '700', marginBottom: 4 },
  modalErrorText: { fontSize: 13, color: Colors.error, lineHeight: 18 },

  // Modify modal
  modifyBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modifySheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.lg, paddingBottom: 36,
  },
  modifyTitle: { ...Typography.h3, marginBottom: 4 },
  modifySubtitle: { fontSize: 12, color: Colors.textMuted, marginBottom: Spacing.md },
  modifyActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  modifySubmitBtn: { flex: 2, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center', backgroundColor: Colors.primary },
  modifySubmitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});


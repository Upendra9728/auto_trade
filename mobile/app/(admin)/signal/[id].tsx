import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, Pressable, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';
import { formatDateTimeIST } from '../../../utils/time';
import StatusBadge from '../../../components/StatusBadge';
import type { AdminSignalDetail, AdminSignalNotificationRow } from '../../../types';

export default function SignalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminSignalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNotif, setSelectedNotif] = useState<AdminSignalNotificationRow | null>(null);

  useEffect(() => {
    if (!id) return;
    adminApi.getSignal(Number(id))
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text>Signal not found.</Text></View>
      </SafeAreaView>
    );
  }

  const { signal, notifications } = detail;

  const counts = notifications.reduce((acc, n) => {
    acc[n.status] = (acc[n.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const renderRow = ({ item: n }: { item: AdminSignalNotificationRow }) => (
    <TouchableOpacity style={styles.row} onPress={() => setSelectedNotif(n)} activeOpacity={0.75}>
      <View style={styles.rowLeft}>
        <Text style={styles.userName}>{n.user_name}</Text>
        <Text style={styles.userEmail}>{n.user_email}</Text>
        {n.assigned_ipv6 && <Text style={styles.ipText}>{n.assigned_ipv6}</Text>}
      </View>
      <View style={styles.rowRight}>
        <StatusBadge status={n.status} size="sm" />
        {n.dhan_order_id && <Text style={styles.orderId} numberOfLines={1}>{n.dhan_order_id}</Text>}
        {n.error_message && <Text style={styles.errorText} numberOfLines={1}>{n.error_message}</Text>}
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle} numberOfLines={1}>Signal #{signal.id}</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(n) => String(n.notification_id)}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <View style={styles.signalCard}>
              <View style={styles.signalTop}>
                <Text style={styles.signalTitle}>{signal.title}</Text>
                <StatusBadge status={signal.status} />
              </View>
              <Text style={styles.signalMeta}>
                {signal.transaction_type} {signal.quantity} × {signal.exchange_segment} / {signal.security_id}
              </Text>
              <View style={styles.priceRow}>
                <PriceChip label="Entry" value={`₹${signal.price}`} />
                <PriceChip label="SL" value={`₹${signal.stop_loss_price}`} color={Colors.error} />
                <PriceChip label="Target" value={`₹${signal.target_price}`} color={Colors.success} />
              </View>
              <Text style={styles.timeText}>{formatDateTimeIST(signal.created_at)}</Text>
            </View>

            {/* Summary */}
            <View style={styles.summaryRow}>
              {Object.entries(counts).map(([status, count]) => (
                <View key={status} style={styles.summaryCell}>
                  <Text style={styles.summaryCount}>{count}</Text>
                  <Text style={styles.summaryLabel}>{status}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Per-User Status ({notifications.length})</Text>
          </View>
        )}
        contentContainerStyle={styles.list}
      />

      {/* ── Per-user detail modal ───────────────────────────────────── */}
      <Modal
        visible={selectedNotif !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedNotif(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSelectedNotif(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalName}>{selectedNotif?.user_name}</Text>
                <Text style={styles.modalEmail}>{selectedNotif?.user_email}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedNotif(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* Status */}
              <View style={styles.modalStatusRow}>
                <StatusBadge status={selectedNotif?.status ?? ''} />
              </View>

              {/* Order ID */}
              {selectedNotif?.dhan_order_id && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Order ID</Text>
                  <Text style={styles.modalMono} selectable>{selectedNotif.dhan_order_id}</Text>
                </View>
              )}

              {/* Error */}
              {selectedNotif?.error_message && (
                <View style={styles.modalErrorBox}>
                  <Text style={styles.modalErrorLabel}>Error</Text>
                  <Text style={styles.modalErrorText} selectable>{selectedNotif.error_message}</Text>
                </View>
              )}

              {/* Timestamps */}
              <View style={styles.modalDivider} />
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Received</Text>
                <Text style={styles.modalValue}>{formatDateTimeIST(selectedNotif?.created_at)}</Text>
              </View>
              {selectedNotif?.confirmed_at && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Confirmed</Text>
                  <Text style={styles.modalValue}>{formatDateTimeIST(selectedNotif.confirmed_at)}</Text>
                </View>
              )}
              {selectedNotif?.placed_at && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Placed</Text>
                  <Text style={[styles.modalValue, { color: Colors.success }]}>{formatDateTimeIST(selectedNotif.placed_at)}</Text>
                </View>
              )}

              {/* IPv6 */}
              {selectedNotif?.assigned_ipv6 && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>IPv6</Text>
                  <Text style={styles.modalMono} selectable>{selectedNotif.assigned_ipv6}</Text>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
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
  list: { padding: Spacing.md, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  signalCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card, gap: 8,
  },
  signalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  signalTitle: { ...Typography.h3, flex: 1, marginRight: 8 },
  signalMeta: { ...Typography.bodySmall },
  priceRow: {
    flexDirection: 'row', backgroundColor: Colors.background,
    borderRadius: Radius.sm, paddingVertical: 8,
  },
  timeText: { ...Typography.caption },
  summaryRow: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: Radius.sm, padding: Spacing.md, ...Shadow.card,
    justifyContent: 'space-around',
  },
  summaryCell: { alignItems: 'center', gap: 2 },
  summaryCount: { fontSize: 22, fontWeight: '800', color: Colors.primary },
  summaryLabel: { fontSize: 10, color: Colors.textMuted, textTransform: 'capitalize' },
  sectionLabel: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: Colors.surface, borderRadius: Radius.sm, padding: Spacing.md, ...Shadow.card,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4, maxWidth: '45%' },
  userName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.textSecondary },
  ipText: { fontSize: 11, fontFamily: 'monospace', color: Colors.info },
  orderId: { fontSize: 11, fontFamily: 'monospace', color: Colors.success },
  errorText: { fontSize: 11, color: Colors.error, textAlign: 'right' },
  chevron: { fontSize: 18, color: Colors.textMuted, marginTop: 2 },

  // ── Modal ──────────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.lg, width: '100%', ...Shadow.card,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  modalName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  modalEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: { fontSize: 18, color: Colors.textMuted, fontWeight: '600', paddingLeft: Spacing.sm },
  modalStatusRow: { alignItems: 'flex-start', marginBottom: Spacing.md },
  modalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 6, gap: Spacing.sm,
  },
  modalLabel: { fontSize: 12, color: Colors.textMuted, flex: 1 },
  modalValue: { fontSize: 13, color: Colors.text, fontWeight: '500', flex: 2, textAlign: 'right' },
  modalMono: { fontSize: 12, fontFamily: 'monospace', color: Colors.info, flex: 2, textAlign: 'right' },
  modalErrorBox: {
    backgroundColor: Colors.errorBg, borderRadius: Radius.sm,
    padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  modalErrorLabel: { fontSize: 11, color: Colors.error, fontWeight: '700', marginBottom: 4 },
  modalErrorText: { fontSize: 13, color: Colors.error, lineHeight: 18 },
  modalDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
});

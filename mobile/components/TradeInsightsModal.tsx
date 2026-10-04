import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography, Shadow, moderateScale } from '../constants/theme';
import { formatDateTimeIST } from '../utils/time';
import { adminApi, userApi } from '../services/api';
import type { SignalTradeInsightsResponse } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  // Provide signalId for admin view, OR notificationId for user view
  signalId?: number | null;
  notificationId?: number | null;
  isAdmin?: boolean;
}

export default function TradeInsightsModal({
  visible,
  onClose,
  signalId,
  notificationId,
  isAdmin = false,
}: Props) {
  const [data, setData] = useState<SignalTradeInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const loadInsights = async () => {
      try {
        if (isAdmin && signalId != null) {
          const res = await adminApi.getSignalInsights(signalId);
          setData(res);
        } else if (notificationId != null) {
          const res = await userApi.getNotificationInsights(notificationId);
          setData(res);
        }
      } catch (err: any) {
        setError(err.message ?? 'Failed to load trade insights');
      } finally {
        setLoading(false);
      }
    };

    void loadInsights();
  }, [visible, signalId, notificationId, isAdmin]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconWrap}>
                <Feather name="bar-chart-2" size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Trade Insights</Text>
                <Text style={styles.headerSub}>
                  {isAdmin ? 'Comprehensive execution analysis' : 'Your trade execution report'}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Analyzing trade performance...</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Feather name="alert-circle" size={36} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : data ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              {/* Signal banner */}
              <View style={styles.signalBanner}>
                <View style={styles.signalBannerTop}>
                  <View style={[styles.txBadge, { backgroundColor: data.transaction_type === 'BUY' ? Colors.buyBg : Colors.sellBg }]}>
                    <Text style={[styles.txText, { color: data.transaction_type === 'BUY' ? Colors.buy : Colors.sell }]}>
                      {data.transaction_type}
                    </Text>
                  </View>
                  <Text style={styles.signalTitle} numberOfLines={1}>{data.signal_title}</Text>
                </View>
                <Text style={styles.signalMeta}>
                  {data.exchange_segment} · {data.security_id} · Created {formatDateTimeIST(data.created_at)}
                </Text>
                {data.completed_at && (
                  <Text style={styles.completedMeta}>
                    🏁 Completed at {formatDateTimeIST(data.completed_at)}
                  </Text>
                )}
              </View>

              {/* KPI Grid */}
              <View style={styles.metricsGrid}>
                {/* Net P&L Card */}
                <View style={[styles.metricCard, styles.metricCardPrimary]}>
                  <Text style={styles.metricLabel}>{isAdmin ? 'Net Realized P&L' : 'Your Realized P&L'}</Text>
                  <Text style={[styles.metricValue, { color: data.net_pnl >= 0 ? Colors.success : Colors.error }]}>
                    {data.net_pnl >= 0 ? `+₹${data.net_pnl.toFixed(2)}` : `-₹${Math.abs(data.net_pnl).toFixed(2)}`}
                  </Text>
                  {isAdmin && (
                    <Text style={styles.metricSub}>
                      Profit: +₹{data.gross_profit.toFixed(0)} · Loss: -₹{data.gross_loss.toFixed(0)}
                    </Text>
                  )}
                </View>

                {/* Win rate / Target hit */}
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>{isAdmin ? 'Win Rate' : 'Result'}</Text>
                  <Text style={[styles.metricValue, { color: data.target_hit_count > 0 ? Colors.success : data.stop_loss_hit_count > 0 ? Colors.error : Colors.text }]}>
                    {isAdmin ? `${data.win_rate_pct}%` : data.target_hit_count > 0 ? '🎯 Target Hit' : data.stop_loss_hit_count > 0 ? '🛑 SL Hit' : 'Exit Complete'}
                  </Text>
                  {isAdmin && (
                    <Text style={styles.metricSub}>
                      🎯 {data.target_hit_count} Hit · 🛑 {data.stop_loss_hit_count} Stop
                    </Text>
                  )}
                </View>

                {/* Total participants / Orders */}
                {isAdmin ? (
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>Participants</Text>
                    <Text style={styles.metricValue}>{data.total_participants}</Text>
                    <Text style={styles.metricSub}>
                      {data.total_orders_placed} placed · Qty {data.total_traded_quantity}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>Executed Qty</Text>
                    <Text style={styles.metricValue}>{data.user_trade?.traded_qty ?? data.total_traded_quantity}</Text>
                    <Text style={styles.metricSub}>
                      Entry ₹{data.entry_price} · Target ₹{data.target_price}
                    </Text>
                  </View>
                )}
              </View>

              {/* Price check levels */}
              <View style={styles.priceRow}>
                <View style={styles.priceCell}>
                  <Text style={styles.priceCellLabel}>Entry</Text>
                  <Text style={styles.priceCellValue}>₹{data.entry_price}</Text>
                </View>
                <View style={styles.priceCell}>
                  <Text style={[styles.priceCellLabel, { color: Colors.error }]}>Stop Loss</Text>
                  <Text style={[styles.priceCellValue, { color: Colors.error }]}>₹{data.stop_loss_price}</Text>
                </View>
                <View style={styles.priceCell}>
                  <Text style={[styles.priceCellLabel, { color: Colors.success }]}>Target</Text>
                  <Text style={[styles.priceCellValue, { color: Colors.success }]}>₹{data.target_price}</Text>
                </View>
              </View>

              {/* User own trade card (if user view) */}
              {!isAdmin && data.user_trade && (
                <View style={styles.userTradeCard}>
                  <Text style={styles.sectionHeading}>Your Trade Summary</Text>
                  <View style={styles.userTradeRow}>
                    <Text style={styles.userTradeLabel}>Traded Qty</Text>
                    <Text style={styles.userTradeValue}>{data.user_trade.traded_qty ?? data.user_trade.ordered_quantity}</Text>
                  </View>
                  {data.user_trade.traded_price != null && (
                    <View style={styles.userTradeRow}>
                      <Text style={styles.userTradeLabel}>Entry Fill Price</Text>
                      <Text style={styles.userTradeValue}>₹{data.user_trade.traded_price.toFixed(2)}</Text>
                    </View>
                  )}
                  {data.user_trade.exit_price != null && (
                    <View style={styles.userTradeRow}>
                      <Text style={styles.userTradeLabel}>Exit Price ({data.user_trade.exit_leg ?? 'EXIT'})</Text>
                      <Text style={[styles.userTradeValue, { color: data.user_trade.exit_leg === 'TARGET_LEG' ? Colors.success : Colors.error }]}>
                        ₹{data.user_trade.exit_price.toFixed(2)}
                      </Text>
                    </View>
                  )}
                  {data.user_trade.realized_pnl != null && (
                    <View style={styles.userTradeRow}>
                      <Text style={styles.userTradeLabel}>Your Net P&L</Text>
                      <Text style={[styles.userTradeValue, { fontWeight: '800', color: data.user_trade.realized_pnl >= 0 ? Colors.success : Colors.error }]}>
                        {data.user_trade.realized_pnl >= 0 ? `+₹${data.user_trade.realized_pnl.toFixed(2)}` : `-₹${Math.abs(data.user_trade.realized_pnl).toFixed(2)}`}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Admin Participants List */}
              {isAdmin && data.participants.length > 0 && (
                <View style={styles.participantsSection}>
                  <Text style={styles.sectionHeading}>
                    Participants Breakdown ({data.participants.length})
                  </Text>
                  {data.participants.map((p) => {
                    const pnl = p.realized_pnl;
                    return (
                      <View key={p.notification_id} style={styles.participantCard}>
                        <View style={styles.participantTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.participantName}>{p.user_name}</Text>
                            <Text style={styles.participantEmail}>{p.user_email}</Text>
                          </View>
                          {pnl != null && (
                            <View style={[styles.pnlChip, { backgroundColor: pnl >= 0 ? Colors.successBg : Colors.errorBg }]}>
                              <Text style={[styles.pnlChipText, { color: pnl >= 0 ? Colors.success : Colors.error }]}>
                                {pnl >= 0 ? `+₹${pnl.toFixed(2)}` : `-₹${Math.abs(pnl).toFixed(2)}`}
                              </Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.participantMeta}>
                          <Text style={styles.metaChip}>Qty {p.traded_qty ?? p.ordered_quantity}</Text>
                          {p.traded_price != null && (
                            <Text style={styles.metaChip}>In: ₹{p.traded_price.toFixed(1)}</Text>
                          )}
                          {p.exit_price != null && (
                            <Text style={[styles.metaChip, { color: p.exit_leg === 'TARGET_LEG' ? Colors.success : Colors.error }]}>
                              Out: ₹{p.exit_price.toFixed(1)} ({p.exit_leg === 'TARGET_LEG' ? 'Target' : 'SL'})
                            </Text>
                          )}
                          {p.is_auto_placed && (
                            <View style={styles.autoPill}><Text style={styles.autoPillText}>AUTO</Text></View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    ...Shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Typography.h3,
    fontSize: moderateScale(16),
  },
  headerSub: {
    ...Typography.caption,
    fontSize: 11,
  },
  closeBtn: {
    padding: 6,
    borderRadius: Radius.full,
    backgroundColor: '#F3F4F6',
  },
  center: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  errorText: {
    fontSize: 13,
    color: Colors.error,
    textAlign: 'center',
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  signalBanner: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 4,
  },
  signalBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  txBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  txText: {
    fontSize: 11,
    fontWeight: '800',
  },
  signalTitle: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  signalMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  completedMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
    marginTop: 2,
  },
  metricsGrid: {
    gap: Spacing.sm,
  },
  metricCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
    gap: 2,
  },
  metricCardPrimary: {
    borderColor: Colors.primaryLight,
    backgroundColor: '#FAFBFF',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: moderateScale(22),
    fontWeight: '800',
  },
  metricSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    justifyContent: 'space-around',
  },
  priceCell: {
    alignItems: 'center',
    gap: 2,
  },
  priceCellLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  priceCellValue: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
  },
  sectionHeading: {
    fontSize: moderateScale(13),
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 6,
  },
  userTradeCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  userTradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  userTradeLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  userTradeValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  participantsSection: {
    gap: Spacing.sm,
  },
  participantCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  participantTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  participantName: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  participantEmail: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  pnlChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  pnlChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  participantMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaChip: {
    fontSize: 10,
    color: Colors.textSecondary,
    backgroundColor: Colors.background,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  autoPill: {
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  autoPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.primary,
  },
});

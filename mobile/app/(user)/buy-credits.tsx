import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { paymentsApi } from '../../services/api';
import { Colors, Radius, Shadow, Spacing, Typography, moderateScale } from '../../constants/theme';
import PlanCard from '../../components/plans/PlanCard';
import CustomPlanCard from '../../components/plans/CustomPlanCard';
import type { CreditPlan, CustomCreditConfig } from '../../types';

// react-native-razorpay is imported dynamically so the screen still renders
// on simulators / web where the native module is absent.
let RazorpayCheckout: any = null;
try {
  RazorpayCheckout = require('react-native-razorpay').default;
} catch {
  // Native module not available (simulator / web)
}

export default function BuyCreditsScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [plans, setPlans] = useState<CreditPlan[]>([]);
  const [customConfig, setCustomConfig] = useState<CustomCreditConfig | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoadingData(true);
      const [plansData, configData] = await Promise.all([
        paymentsApi.getPlans(),
        paymentsApi.getCustomConfig().catch(() => null),
      ]);
      setPlans(plansData);
      setCustomConfig(configData);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load plans. ' + (err?.message ?? ''));
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startCheckout = async (planId: string, credits?: number) => {
    if (!RazorpayCheckout) {
      Alert.alert(
        'Checkout Unavailable',
        'In-app Razorpay checkout requires the native Android APK build. Please test on an installed device.',
      );
      return;
    }

    try {
      setProcessingPlanId(planId === 'custom' ? 'custom' : planId);

      // 1. Create order on backend
      const order = await paymentsApi.createOrder(planId, credits);

      // 2. Launch native Razorpay checkout sheet
      const options = {
        description: order.plan.description || `Purchase ${order.plan.total_credits} Credits`,
        image: 'https://www.tradingfloor.co.in/favicon.ico',
        currency: order.currency,
        key: order.key_id,
        amount: order.amount_paise,
        name: 'Trading Floor',
        order_id: order.razorpay_order_id,
        prefill: {
          email: user?.email || '',
          contact: user?.phone_number || '',
          name: user?.name || '',
        },
        theme: { color: Colors.primary },
      };

      const paymentData = await RazorpayCheckout.open(options);

      // 3. Verify signature cryptographically on backend
      await paymentsApi.verifyPayment({
        razorpay_order_id: paymentData.razorpay_order_id || order.razorpay_order_id,
        razorpay_payment_id: paymentData.razorpay_payment_id,
        razorpay_signature: paymentData.razorpay_signature,
      });

      // 4. Update user state and notify
      await refreshUser();
      Alert.alert(
        'Payment Successful!',
        `${order.plan.total_credits} credits have been added to your balance.`,
      );
    } catch (err: any) {
      // Code 0 or description containing cancelled means user backed out
      const isCancelled =
        err?.code === 0 ||
        err?.description?.toLowerCase().includes('cancelled') ||
        err?.message?.toLowerCase().includes('cancelled');

      if (!isCancelled) {
        Alert.alert(
          'Payment Not Completed',
          err?.description || err?.message || 'Payment could not be processed. Please try again.',
        );
      }
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleBuyPlan = (plan: CreditPlan) => {
    startCheckout(plan.id);
  };

  const handleBuyCustom = (credits: number) => {
    startCheckout('custom', credits);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Buy Credits</Text>
        <View style={styles.creditsChip}>
          <Feather name="zap" size={13} color={Colors.primary} />
          <Text style={styles.creditsChipText}>{user?.credits ?? 0} credits</Text>
        </View>
      </View>

      {/* ── Content ── */}
      {loadingData ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading plans…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Credit Usage Info Card */}
          <View style={styles.infoCard}>
            {/* Prominent callout: credits are only debited on target hit */}
            <View style={styles.calloutBanner}>
              <Feather name="check-circle" size={16} color={Colors.success} />
              <Text style={styles.calloutText}>
                Credits are debited only when your order hits its target — no charge for stop-loss exits, cancellations, or rejections.
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoIconWrap}>
                <Feather name="zap" size={14} color={Colors.primary} />
              </View>
              <Text style={styles.infoText}>
                <Text style={styles.infoBold}>1 credit</Text> = 1 order that hits its target
              </Text>
            </View>

            <View style={styles.infoRow}>
              <View style={[styles.infoIconWrap, { backgroundColor: Colors.warningBg }]}>
                <Feather name="cpu" size={14} color={Colors.warning} />
              </View>
              <Text style={styles.infoText}>
                <Text style={[styles.infoBold, { color: Colors.warning }]}>Special Auto Trade</Text> = 3 credits when it hits target
              </Text>
            </View>

            <View style={styles.infoDivider} />

            <View style={styles.infoGstRow}>
              <Feather name="info" size={12} color={Colors.textMuted} />
              <Text style={styles.infoGstText}>
                All prices include 18% GST — no hidden fees at checkout
              </Text>
            </View>
          </View>

          {/* Feature highlights */}
          <View style={styles.highlights}>
            {[
              { icon: 'shield' as const, text: 'Secure in-app payment via Razorpay' },
              { icon: 'zap' as const, text: 'Credits added instantly to your wallet' },
              { icon: 'gift' as const, text: '20% bonus credits on orders over 5 credits' },
            ].map((item) => (
              <View key={item.text} style={styles.highlightItem}>
                <View style={styles.highlightIcon}>
                  <Feather name={item.icon} size={14} color={Colors.primary} />
                </View>
                <Text style={styles.highlightText}>{item.text}</Text>
              </View>
            ))}
          </View>

          {/* Plan Cards */}
          <Text style={styles.sectionTitle}>Choose a Standard Plan</Text>
          <View style={styles.cardsContainer}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onBuy={handleBuyPlan}
                loading={processingPlanId === plan.id}
                selected={processingPlanId === plan.id}
              />
            ))}
          </View>

          {/* Custom Plan Card */}
          {customConfig && (
            <>
              <Text style={styles.sectionTitle}>Custom Credit Amount</Text>
              <CustomPlanCard
                config={customConfig}
                onBuy={handleBuyCustom}
                loading={processingPlanId === 'custom'}
              />
            </>
          )}

          {/* Footer note */}
          <View style={styles.footerNote}>
            <Feather name="info" size={13} color={Colors.textMuted} />
            <Text style={styles.footerNoteText}>
              Credits never expire. All payments are secured by Razorpay. For support, contact us.
            </Text>
          </View>

          <View style={{ height: Spacing.xl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: moderateScale(18),
    fontWeight: '700',
    color: Colors.text,
  },
  creditsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  creditsChipText: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.primary,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
    ...Shadow.card,
  },
  calloutBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.successBg,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    marginBottom: 4,
  },
  calloutText: {
    flex: 1,
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: Colors.success,
    lineHeight: 17,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    fontSize: moderateScale(12),
    color: Colors.text,
    flex: 1,
  },
  infoBold: {
    fontWeight: '700',
    color: Colors.text,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  infoGstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  infoGstText: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: moderateScale(14),
    color: Colors.textSecondary,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.md,
  },
  highlights: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 10,
    marginBottom: Spacing.md,
    ...Shadow.card,
  },
  highlightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  highlightIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightText: {
    fontSize: moderateScale(13),
    color: Colors.text,
    fontWeight: '500',
    flex: 1,
  },
  sectionTitle: {
    fontSize: moderateScale(16),
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
    marginTop: Spacing.sm,
  },
  cardsContainer: {
    gap: 4,
    paddingTop: 12, // room for the badge that floats above the card
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  footerNoteText: {
    flex: 1,
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    lineHeight: 18,
  },
});


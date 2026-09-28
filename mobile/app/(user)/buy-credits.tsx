import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { paymentsApi } from '../../services/api';
import { Colors, Radius, Shadow, Spacing, Typography, moderateScale } from '../../constants/theme';
import PlanCard from '../../components/plans/PlanCard';
import type { CreditPlan } from '../../types';

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
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      setLoadingPlans(true);
      const data = await paymentsApi.getPlans();
      setPlans(data);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to load plans. ' + (err?.message ?? ''));
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleBuy = async (plan: CreditPlan) => {
    let url = '';
    if (plan.id === 'basic') {
      url = 'https://rzp.io/rzp/JrqgY4G';
    } else if (plan.id === 'intermediate') {
      url = 'https://rzp.io/rzp/5427OEF';
    } else if (plan.id === 'pro') {
      url = 'https://rzp.io/rzp/R1PKfnIu';
    }

    if (!url) return;

    // Pre-fill email and phone number using URL parameters
    const emailParam = user?.email ? `?email=${encodeURIComponent(user.email)}` : '?';
    const phoneParam = user?.phone_number ? `&contact=${encodeURIComponent(user.phone_number)}` : '';
    const finalUrl = `${url}${emailParam}${phoneParam}`;

    Alert.alert(
      'Proceed to Payment',
      'You will be securely redirected to Razorpay. Once your payment is successful, your credits will be added automatically!',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Continue', 
          onPress: () => {
            Linking.openURL(finalUrl);
            // We refresh the user automatically after a short delay so they see credits 
            // when they return to the app (the backend webhook handles the actual addition).
            setTimeout(() => refreshUser(), 10000);
          } 
        }
      ]
    );
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

      {/* ── Subtitle ── */}
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          1 credit = 1 order placed via trading signal
        </Text>
      </View>

      {/* ── Content ── */}
      {loadingPlans ? (
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
          {/* Feature highlights */}
          <View style={styles.highlights}>
            {[
              { icon: 'shield' as const, text: 'Secure payment via Razorpay' },
              { icon: 'zap' as const, text: 'Credits added instantly' },
              { icon: 'gift' as const, text: 'Bonus credits on bigger plans' },
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
          <Text style={styles.sectionTitle}>Choose a Plan</Text>
          <View style={styles.cardsContainer}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onBuy={handleBuy}
                loading={processingPlanId === plan.id}
                selected={processingPlanId === plan.id}
              />
            ))}
          </View>

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
  subtitleRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subtitle: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
    fontStyle: 'italic',
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


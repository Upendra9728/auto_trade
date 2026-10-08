import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, moderateScale } from '../../constants/theme';
import { paymentsApi } from '../../services/api';
import type { CreditPlan } from '../../types';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W * 0.6;
const CARD_GAP = 12;

const PLAN_COLORS: Record<string, { bg: string; accent: string; light: string }> = {
  basic:        { bg: '#1E40AF', accent: '#3B82F6', light: '#EFF6FF' },
  intermediate: { bg: '#5B21B6', accent: '#7C3AED', light: '#F5F3FF' },
  pro:          { bg: '#92400E', accent: '#D97706', light: '#FFFBEB' },
};

function MiniPlanCard({ plan, onPress }: { plan: CreditPlan; onPress: () => void }) {
  const colors = PLAN_COLORS[plan.id] ?? PLAN_COLORS.basic;
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.miniCard, { backgroundColor: colors.bg }]}
    >
      {/* Badge */}
      {plan.badge ? (
        <View style={[styles.miniBadge, { backgroundColor: colors.accent }]}>
          <Text style={styles.miniBadgeText}>{plan.badge}</Text>
        </View>
      ) : null}

      {/* Plan name */}
      <Text style={styles.miniPlanName}>{plan.name}</Text>

      {/* Price */}
      <View style={styles.miniPriceRow}>
        <Text style={styles.miniCurrency}>₹</Text>
        <Text style={styles.miniPrice}>{plan.amount_rs.toLocaleString('en-IN')}</Text>
      </View>

      {/* Credits */}
      <View style={[styles.miniCreditsRow, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
        <Feather name="zap" size={12} color="#fff" />
        <Text style={styles.miniCreditsText}>
          {plan.total_credits} Credits
          {plan.bonus_credits > 0 ? ` (+${plan.bonus_credits} free)` : ''}
        </Text>
      </View>

      {/* CTA arrow */}
      <View style={styles.miniCta}>
        <Text style={styles.miniCtaText}>Buy Now</Text>
        <Feather name="arrow-right" size={12} color="#fff" />
      </View>
    </TouchableOpacity>
  );
}

function MiniCustomPlanCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.miniCard, { backgroundColor: '#064E3B' }]}
    >
      {/* Badge */}
      <View style={[styles.miniBadge, { backgroundColor: '#059669' }]}>
        <Text style={styles.miniBadgeText}>CUSTOM PACK</Text>
      </View>

      {/* Plan name */}
      <Text style={styles.miniPlanName}>Custom Plan</Text>

      {/* Price */}
      <View style={styles.miniPriceRow}>
        <Text style={styles.miniCurrency}>₹</Text>
        <Text style={styles.miniPrice}>118</Text>
        <Text style={[styles.miniCurrency, { fontSize: moderateScale(11), marginLeft: 4, marginTop: 10 }]}>
          onwards
        </Text>
      </View>

      {/* Credits */}
      <View style={[styles.miniCreditsRow, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
        <Feather name="sliders" size={12} color="#fff" />
        <Text style={styles.miniCreditsText}>
          1–100 Credits (+20% bonus)
        </Text>
      </View>

      {/* CTA arrow */}
      <View style={styles.miniCta}>
        <Text style={styles.miniCtaText}>Customize</Text>
        <Feather name="arrow-right" size={12} color="#fff" />
      </View>
    </TouchableOpacity>
  );
}

export default function PlansBanner() {
  const router = useRouter();
  const [plans, setPlans] = useState<CreditPlan[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const currentIndex = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slideAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    paymentsApi.getPlans().then(setPlans).catch(() => {});
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const totalCards = plans.length + 1;

  const startAutoScroll = useCallback(() => {
    clearTimer();
    const count = plans.length + 1;
    if (count <= 1) return;
    timerRef.current = setInterval(() => {
      currentIndex.current = (currentIndex.current + 1) % count;
      setActiveIndex(currentIndex.current);
      scrollRef.current?.scrollTo({
        x: currentIndex.current * (CARD_W + CARD_GAP),
        animated: true,
      });
    }, 3000);
  }, [clearTimer, plans.length]);

  useEffect(() => {
    startAutoScroll();
    return () => clearTimer();
  }, [startAutoScroll, clearTimer]);

  const handleScrollBeginDrag = () => {
    clearTimer();
  };

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const newIndex = Math.round(offsetX / (CARD_W + CARD_GAP));
    const clamped = Math.max(0, Math.min(newIndex, plans.length));
    currentIndex.current = clamped;
    setActiveIndex(clamped);
    startAutoScroll();
  };

  if (plans.length === 0) return null;

  const handleCardPress = () => {
    router.push('/(user)/buy-credits' as any);
  };

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.lightningIcon}>
            <Feather name="zap" size={14} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Top Up Credits</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/(user)/buy-credits' as any)}
          style={styles.viewAllBtn}
          activeOpacity={0.8}
        >
          <Text style={styles.viewAllText}>View All</Text>
          <Feather name="chevron-right" size={14} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Scrollable plan cards */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.scrollContent}
        onScrollBeginDrag={handleScrollBeginDrag}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={(e) => {
          // Fallback if there is no momentum scroll
          handleScrollEnd(e);
        }}
      >
        {plans.map((plan) => (
          <MiniPlanCard key={plan.id} plan={plan} onPress={handleCardPress} />
        ))}
        <MiniCustomPlanCard onPress={handleCardPress} />
      </ScrollView>

      {/* Dot indicators */}
      <View style={styles.dots}>
        {[...plans, { id: 'custom' }].map((p, i) => (
          <View
            key={p.id}
            style={[
              styles.dot,
              i === activeIndex ? styles.dotActive : styles.dotInactive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lightningIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: moderateScale(15),
    fontWeight: '700',
    color: Colors.text,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: moderateScale(13),
    fontWeight: '600',
    color: Colors.primary,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    gap: CARD_GAP,
  },
  miniCard: {
    width: CARD_W,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 8,
    overflow: 'hidden',
  },
  miniBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  miniBadgeText: {
    color: '#fff',
    fontSize: moderateScale(9),
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  miniPlanName: {
    color: '#fff',
    fontSize: moderateScale(16),
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  miniPriceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  miniCurrency: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: moderateScale(14),
    fontWeight: '600',
    marginTop: 2,
  },
  miniPrice: {
    color: '#fff',
    fontSize: moderateScale(28),
    fontWeight: '900',
    lineHeight: moderateScale(33),
  },
  miniCreditsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    alignSelf: 'flex-start',
  },
  miniCreditsText: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '600',
  },
  miniCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  miniCtaText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: moderateScale(12),
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 18,
  },
  dotInactive: {
    backgroundColor: Colors.border,
  },
});


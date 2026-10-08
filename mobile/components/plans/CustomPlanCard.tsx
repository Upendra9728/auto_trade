import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, moderateScale } from '../../constants/theme';
import type { CustomCreditConfig } from '../../types';

interface CustomPlanCardProps {
  config: CustomCreditConfig;
  onBuy: (credits: number) => void;
  loading?: boolean;
}

const THEME = {
  accent: '#059669',
  accentLight: '#ECFDF5',
  gradStart: '#064E3B',
  border: '#A7F3D0',
};

const QUICK_PRESETS = [10, 20, 50, 100];

export default function CustomPlanCard({ config, onBuy, loading = false }: CustomPlanCardProps) {
  const [credits, setCredits] = useState<number>(20);
  const [inputText, setInputText] = useState<string>('20');
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const min = config.min_credits;
  const max = config.max_credits;

  const updateCredits = (val: number) => {
    const clamped = Math.max(min, Math.min(max, val));
    setCredits(clamped);
    setInputText(String(clamped));
  };

  const handleInputChange = (text: string) => {
    const clean = text.replace(/[^0-9]/g, '');
    setInputText(clean);
    if (!clean) return;
    const num = parseInt(clean, 10);
    if (!isNaN(num)) {
      setCredits(Math.max(min, Math.min(max, num)));
    }
  };

  const handleInputBlur = () => {
    if (!inputText || isNaN(parseInt(inputText, 10))) {
      updateCredits(min);
    } else {
      updateCredits(parseInt(inputText, 10));
    }
  };

  const paidCredits = Math.max(min, Math.min(max, credits));
  const hasBonus = paidCredits > config.bonus_credit_threshold;
  const bonusCredits = hasBonus ? Math.floor((paidCredits * config.bonus_credit_percent) / 100) : 0;
  const totalCredits = paidCredits + bonusCredits;

  const baseAmount = paidCredits * config.credit_value_rs;
  const gstAmount = Math.round((baseAmount * config.gst_percent) / 100);
  const totalAmount = baseAmount + gstAmount;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true, speed: 30 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
  };

  return (
    <Animated.View style={[styles.cardWrapper, { transform: [{ scale: scaleAnim }] }]}>
      {/* ── Badge ── */}
      <View style={[styles.badge, { backgroundColor: THEME.accent }]}>
        <Feather name="sliders" size={11} color="#fff" style={{ marginRight: 4 }} />
        <Text style={styles.badgeText}>CUSTOM PACK</Text>
      </View>

      {/* ── Header ── */}
      <View style={[styles.header, { backgroundColor: THEME.gradStart }]}>
        <Text style={styles.planName}>Custom Plan</Text>
        <Text style={styles.headerSubtitle}>Choose exactly how many credits you need</Text>

        <View style={styles.priceRow}>
          <Text style={styles.currency}>₹</Text>
          <Text style={styles.price}>{totalAmount.toLocaleString('en-IN')}</Text>
          <Text style={styles.priceGstNote}>(incl. 18% GST)</Text>
        </View>
      </View>

      {/* ── Credit Selector & Presets ── */}
      <View style={[styles.body, { backgroundColor: THEME.accentLight }]}>
        {/* Stepper + Input */}
        <View style={styles.stepperContainer}>
          <TouchableOpacity
            style={[styles.stepBtn, paidCredits <= min && styles.stepBtnDisabled]}
            onPress={() => updateCredits(paidCredits - 5)}
            disabled={paidCredits <= min || loading}
          >
            <Feather name="minus" size={18} color={paidCredits <= min ? Colors.textMuted : THEME.accent} />
          </TouchableOpacity>

          <View style={styles.inputWrap}>
            <TextInput
              style={styles.creditInput}
              keyboardType="number-pad"
              value={inputText}
              onChangeText={handleInputChange}
              onBlur={handleInputBlur}
              maxLength={4}
              editable={!loading}
            />
            <Text style={styles.creditInputLabel}>Credits</Text>
          </View>

          <TouchableOpacity
            style={[styles.stepBtn, paidCredits >= max && styles.stepBtnDisabled]}
            onPress={() => updateCredits(paidCredits + 5)}
            disabled={paidCredits >= max || loading}
          >
            <Feather name="plus" size={18} color={paidCredits >= max ? Colors.textMuted : THEME.accent} />
          </TouchableOpacity>
        </View>

        {/* Quick presets */}
        <View style={styles.presetsRow}>
          {QUICK_PRESETS.map((val) => {
            const isSelected = paidCredits === val;
            return (
              <TouchableOpacity
                key={val}
                style={[
                  styles.presetChip,
                  isSelected && { backgroundColor: THEME.accent, borderColor: THEME.accent },
                ]}
                onPress={() => updateCredits(val)}
                disabled={loading}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    isSelected && { color: '#fff', fontWeight: '700' },
                  ]}
                >
                  {val}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bonus indicator banner */}
        {hasBonus ? (
          <View style={styles.bonusBanner}>
            <Feather name="gift" size={14} color={THEME.accent} />
            <Text style={styles.bonusBannerText}>
              +{bonusCredits} Bonus Credits ({config.bonus_credit_percent}% extra free)
            </Text>
          </View>
        ) : (
          <View style={styles.hintBanner}>
            <Feather name="info" size={13} color={Colors.textSecondary} />
            <Text style={styles.hintBannerText}>
              Buy {config.bonus_credit_threshold + 1 - paidCredits} more to unlock {config.bonus_credit_percent}% extra bonus credits!
            </Text>
          </View>
        )}

        {/* Price Breakdown */}
        <View style={styles.breakdown}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Base ({paidCredits} × ₹{config.credit_value_rs})</Text>
            <Text style={styles.detailValue}>₹{baseAmount.toLocaleString('en-IN')}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>GST ({config.gst_percent}%)</Text>
            <Text style={styles.detailValue}>₹{gstAmount.toLocaleString('en-IN')}</Text>
          </View>

          {bonusCredits > 0 && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: THEME.accent, fontWeight: '600' }]}>
                Free Bonus Credits
              </Text>
              <Text style={[styles.detailValue, { color: THEME.accent, fontWeight: '700' }]}>
                +{bonusCredits} FREE
              </Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>You Get</Text>
            <View style={[styles.totalBadge, { backgroundColor: THEME.accent }]}>
              <Text style={styles.totalValue}>{totalCredits} Credits</Text>
            </View>
          </View>

          <Text style={styles.effectivePerCredit}>
            Effective: ₹{(totalAmount / totalCredits).toFixed(1)} per credit
          </Text>
        </View>
      </View>

      {/* ── Buy Button ── */}
      <TouchableOpacity
        style={[styles.buyBtn, { backgroundColor: THEME.accent }, loading && styles.buyBtnDisabled]}
        onPress={() => onBuy(paidCredits)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <Text style={styles.buyBtnText}>Processing…</Text>
        ) : (
          <>
            <Feather name="zap" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.buyBtnText}>
              Buy {totalCredits} Credits — ₹{totalAmount.toLocaleString('en-IN')}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardWrapper: {
    borderRadius: Radius.lg,
    overflow: 'visible',
    backgroundColor: Colors.surface,
    ...Shadow.card,
    elevation: 4,
    borderWidth: 1.5,
    borderColor: THEME.border,
    marginBottom: Spacing.md,
    marginTop: 4,
  },
  badge: {
    position: 'absolute',
    top: -12,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
    zIndex: 10,
  },
  badgeText: {
    color: '#fff',
    fontSize: moderateScale(11),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  header: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.md,
    paddingTop: Spacing.lg,
  },
  planName: {
    color: '#fff',
    fontSize: moderateScale(20),
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: moderateScale(12),
    marginBottom: 8,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  currency: {
    color: '#fff',
    fontSize: moderateScale(18),
    fontWeight: '700',
  },
  price: {
    color: '#fff',
    fontSize: moderateScale(28),
    fontWeight: '800',
  },
  priceGstNote: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: moderateScale(11),
    marginLeft: 6,
  },
  body: {
    padding: Spacing.md,
    gap: 12,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 16,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME.border,
  },
  stepBtnDisabled: {
    opacity: 0.4,
    backgroundColor: Colors.background,
    borderColor: Colors.border,
  },
  inputWrap: {
    alignItems: 'center',
    minWidth: 90,
  },
  creditInput: {
    fontSize: moderateScale(26),
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    paddingVertical: 0,
  },
  creditInputLabel: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    fontWeight: '600',
  },
  presetsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  presetChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  presetChipText: {
    fontSize: moderateScale(12),
    color: Colors.text,
    fontWeight: '600',
  },
  bonusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D1FAE5',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
  },
  bonusBannerText: {
    fontSize: moderateScale(12),
    color: THEME.accent,
    fontWeight: '700',
    flex: 1,
  },
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hintBannerText: {
    fontSize: moderateScale(11),
    color: Colors.textSecondary,
    flex: 1,
  },
  breakdown: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: moderateScale(12),
    color: Colors.text,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
  },
  totalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  totalValue: {
    fontSize: moderateScale(13),
    fontWeight: '800',
    color: '#fff',
  },
  effectivePerCredit: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
  },
  buyBtnDisabled: {
    opacity: 0.6,
  },
  buyBtnText: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '700',
  },
});

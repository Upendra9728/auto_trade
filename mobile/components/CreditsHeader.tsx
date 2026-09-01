import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { Colors, Spacing, moderateScale } from '../constants/theme';

export default function CreditsHeader() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  if (!user) return null;

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 10 : 0);

  return (
    <View style={[styles.container, { paddingTop: topInset + Spacing.sm }]}>
      <View style={styles.creditsBox}>
        <Feather name="zap" size={20} color={Colors.primary} />
        <Text style={styles.creditsLabel}>Available Credits</Text>
        <Text style={[styles.creditsValue, user.credits === 0 && styles.creditsValueZero]}>
          {user.credits}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  creditsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: 8,
  },
  creditsLabel: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
    flex: 1,
  },
  creditsValue: {
    fontSize: moderateScale(18),
    fontWeight: '800',
    color: Colors.primary,
    minWidth: 40,
    textAlign: 'right',
  },
  creditsValueZero: {
    color: '#FF6B6B',
  },
});

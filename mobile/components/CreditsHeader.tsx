import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { Colors, Radius, moderateScale } from '../constants/theme';

export default function CreditsHeader() {
  const { user } = useAuth();
  const router = useRouter();

  if (!user) return null;

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Text style={styles.label}>Available Credits</Text>
        <View style={styles.valueRow}>
          <Feather name="zap" size={16} color={Colors.primary} />
          <Text style={[styles.creditsValue, user.credits === 0 && styles.creditsValueZero]}>
            {user.credits}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.topUpBtn}
        onPress={() => router.push('/(user)/buy-credits' as any)}
        activeOpacity={0.8}
      >
        <Feather name="plus" size={12} color="#fff" />
        <Text style={styles.topUpText}>Top Up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 8,
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: { fontSize: moderateScale(12), fontWeight: '700', color: Colors.textSecondary },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  creditsValue: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: Colors.primary,
  },
  creditsValueZero: {
    color: '#FF6B6B',
  },
  topUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  topUpText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
});

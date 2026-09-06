import React from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { Colors, moderateScale } from '../constants/theme';

export default function CreditsHeader() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Available Credits</Text>
      <View style={styles.valueRow}>
        <Feather name="zap" size={16} color={Colors.primary} />
        <Text style={[styles.creditsValue, user.credits === 0 && styles.creditsValueZero]}>
          {user.credits}
        </Text>
      </View>
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
});

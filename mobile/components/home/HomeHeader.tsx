import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors, Spacing, moderateScale } from '../../constants/theme';

interface Props {
  onNotificationPress?: () => void;
  onProfilePress?: () => void;
}

export default function HomeHeader({ onNotificationPress, onProfilePress }: Props) {
  return (
    <View style={styles.container}>
      {/* Logo + Brand */}
      <View style={styles.brandRow}>
        <View style={styles.logoIcon}>
          {/* Stylized bar-chart bars using views */}
          <View style={styles.bars}>
            <View style={[styles.bar, { height: 10, backgroundColor: '#3B82F6' }]} />
            <View style={[styles.bar, { height: 16, backgroundColor: '#1E40AF' }]} />
            <View style={[styles.bar, { height: 12, backgroundColor: '#3B82F6' }]} />
            <View style={[styles.bar, { height: 20, backgroundColor: '#1E40AF' }]} />
          </View>
        </View>
        <View style={styles.textGroup}>
          <Text style={styles.brandName}>Trading Floor</Text>
          <Text style={styles.brandCaption}>TRADE SMARTER TOGETHER</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.iconBtn} onPress={onNotificationPress} activeOpacity={0.7}>
          <Feather name="bell" size={22} color={Colors.text} />
          {/* Notification dot */}
          <View style={styles.notifDot} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.avatarBtn} onPress={onProfilePress} activeOpacity={0.7}>
          <Ionicons name="person-circle-outline" size={34} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 36,
    height: 36,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  bar: {
    width: 6,
    borderRadius: 2,
  },
  textGroup: {
    gap: 1,
  },
  brandName: {
    fontSize: moderateScale(20),
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  brandCaption: {
    fontSize: moderateScale(9),
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 1.5,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconBtn: {
    position: 'relative',
    padding: 6,
  },
  notifDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  avatarBtn: {
    padding: 2,
  },
});

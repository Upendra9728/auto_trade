import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography } from '../constants/theme';

interface RightAction {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
}

interface Props {
  title: string;
  onBack?: () => void;
  rightAction?: RightAction;
}

// Shared title bar used across all admin screens for a consistent look —
// optional back chevron on the left, optional single action button on the right.
export default function AdminScreenHeader({ title, onBack, rightAction }: Props) {
  return (
    <View style={styles.headerBar}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.sideSlot} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={24} color={Colors.primary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.sideSlot} />
      )}

      <Text style={styles.pageTitle} numberOfLines={1}>{title}</Text>

      {rightAction ? (
        <TouchableOpacity style={styles.actionBtn} onPress={rightAction.onPress} disabled={rightAction.loading}>
          {rightAction.loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              {rightAction.icon && <Feather name={rightAction.icon} size={14} color="#fff" />}
              <Text style={styles.actionText}>{rightAction.label}</Text>
            </>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.sideSlot} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sideSlot: { width: 44, alignItems: 'flex-start', justifyContent: 'center' },
  pageTitle: { ...Typography.h3, flex: 1, textAlign: 'center' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    minWidth: 44,
    justifyContent: 'center',
  },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography } from '../constants/theme';
import TelegramAutomationToggle from './TelegramAutomationToggle';

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
  hideTelegramToggle?: boolean;
}

// Shared title bar used across all admin screens for a consistent look —
// back chevron on the left if applicable, Telegram automation toggle & actions on the right.
export default function AdminScreenHeader({ title, onBack, rightAction, hideTelegramToggle }: Props) {
  return (
    <View style={styles.headerBar}>
      <View style={styles.leftSlot}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="chevron-left" size={24} color={Colors.primary} />
          </TouchableOpacity>
        )}
        <Text style={styles.pageTitle} numberOfLines={1}>{title}</Text>
      </View>

      <View style={styles.rightSlot}>
        {!hideTelegramToggle && <TelegramAutomationToggle />}

        {rightAction && (
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
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  leftSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  backBtn: {
    padding: 2,
    marginRight: 2,
  },
  pageTitle: {
    ...Typography.h3,
    flex: 1,
  },
  rightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    justifyContent: 'center',
  },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

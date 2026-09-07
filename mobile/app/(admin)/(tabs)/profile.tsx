import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, TextInput, Switch, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '../../../contexts/AuthContext';
import { userApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';

export default function AdminProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const currentVersion = Constants.expoConfig?.version ?? '0.0.0';
  const [telegramAutomationEnabled, setTelegramAutomationEnabled] = useState(false);
  const [telegramChannelName, setTelegramChannelName] = useState('');
  const [savingTelegramSettings, setSavingTelegramSettings] = useState(false);

  useEffect(() => {
    if (!user) return;
    setTelegramAutomationEnabled(Boolean(user.telegram_automation_enabled));
    setTelegramChannelName(user.telegram_channel_name ?? '');
  }, [user?.telegram_automation_enabled, user?.telegram_channel_name]);

  const handleSaveTelegramSettings = async (
    nextEnabled: boolean = telegramAutomationEnabled,
    nextChannel: string = telegramChannelName,
  ) => {
    setSavingTelegramSettings(true);
    try {
      await userApi.updateProfile({
        telegram_automation_enabled: nextEnabled,
        telegram_channel_name: nextChannel.trim() || null,
      });
      await refreshUser();
      setTelegramAutomationEnabled(nextEnabled);
      setTelegramChannelName(nextChannel.trim());
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to update Telegram settings.');
    } finally {
      setSavingTelegramSettings(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Admin Profile</Text>
        </View>

        {/* Avatar & Name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Feather name="user" size={40} color={Colors.primary} />
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>ADMIN</Text>
          </View>
        </View>

        {/* Account Info Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account Information</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{user?.phone_number}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Account Status</Text>
            <View style={[styles.statusBadge, user?.is_active && styles.statusActive]}>
              <Text style={styles.statusText}>{user?.is_active ? 'Active' : 'Inactive'}</Text>
            </View>
          </View>

          {user?.assigned_ipv6 && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Assigned IPv6</Text>
                <Text style={[styles.infoValue, styles.ipv6Text]}>{user.assigned_ipv6}</Text>
              </View>
            </>
          )}

          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App Version</Text>
            <Text style={styles.infoValue}>v{currentVersion}</Text>
          </View>
        </View>

        {/* Telegram automation */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Telegram Automation</Text>
            <Switch
              value={telegramAutomationEnabled}
              onValueChange={async (value: boolean) => {
                setTelegramAutomationEnabled(value);
                await handleSaveTelegramSettings(value);
              }}
              disabled={savingTelegramSettings}
              trackColor={{ false: Colors.border, true: Colors.primary }}
            />
          </View>

          <Text style={styles.helperText}>
            Enable this to accept signal messages from the configured Telegram channel.
            When it is off, incoming messages are ignored.
          </Text>

          <View style={[styles.field, !telegramAutomationEnabled && { opacity: 0.5 }]}> 
            <Text style={styles.label}>Configured channel</Text>
            <TextInput
              style={styles.input}
              value={telegramChannelName || 'Any channel allowed'}
              editable={false}
              placeholder="@signals or signals"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hintText}>
              This value is read from the admin profile and is used by the backend to filter incoming Telegram signals.
              {telegramChannelName ? ' The bot only accepts messages from this channel.' : ' No specific channel is configured, so any channel is accepted while automation is enabled.'}
            </Text>
          </View>
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Feather name="log-out" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.xl,
  },
  title: {
    ...Typography.h1,
    color: Colors.text,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    ...Shadow.card,
  },
  name: {
    ...Typography.h2,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  roleBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  roleText: {
    ...Typography.caption,
    color: Colors.surface,
    fontWeight: '700',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  cardTitle: {
    ...Typography.h3,
    color: Colors.text,
  },
  helperText: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 19,
  },
  field: {
    gap: Spacing.xs,
  },
  label: {
    ...Typography.label,
    color: Colors.text,
  },
  input: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.text,
    fontSize: 14,
  },
  hintText: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    ...Typography.body,
    color: Colors.textMuted,
    flex: 1,
  },
  infoValue: {
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  ipv6Text: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: Colors.error + '20',
  },
  statusActive: {
    backgroundColor: Colors.success + '20',
  },
  statusText: {
    ...Typography.caption,
    fontWeight: '600',
    color: Colors.error,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error + '15',
    borderColor: Colors.error,
    borderWidth: 1.5,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  logoutText: {
    ...Typography.body,
    color: Colors.error,
    fontWeight: '600',
  },
});

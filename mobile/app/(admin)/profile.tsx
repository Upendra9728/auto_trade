import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';

export default function AdminProfileScreen() {
  const { user, logout } = useAuth();

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
  cardTitle: {
    ...Typography.h3,
    color: Colors.text,
    marginBottom: Spacing.md,
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

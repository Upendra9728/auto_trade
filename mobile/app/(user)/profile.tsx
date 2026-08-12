import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { userApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateIST } from '../../utils/time';
import type { DhanCredential } from '../../types';

export default function ProfileScreen() {
  const { user, logout, refreshUser } = useAuth();
  const [dhan, setDhan] = useState<DhanCredential | null>(null);
  const [dhanForm, setDhanForm] = useState({ dhan_client_id: '', access_token: '' });
  const [savingDhan, setSavingDhan] = useState(false);
  const [showDhanForm, setShowDhanForm] = useState(false);
  const [testingIp, setTestingIp] = useState(false);
  const [refreshingDhan, setRefreshingDhan] = useState(false);

  useEffect(() => {
    userApi.getDhanCredential().then(setDhan).catch(() => {});
  }, []);

  const handleSaveDhan = async () => {
    if (!dhanForm.dhan_client_id.trim() || !dhanForm.access_token.trim()) {
      Alert.alert('Missing fields', 'Enter both Dhan Client ID and Access Token.');
      return;
    }
    setSavingDhan(true);
    try {
      const saved = await userApi.saveDhanCredential({
        dhan_client_id: dhanForm.dhan_client_id.trim(),
        access_token: dhanForm.access_token.trim(),
      });
      setDhan(saved);
      setShowDhanForm(false);
      setDhanForm({ dhan_client_id: '', access_token: '' });
      Alert.alert('Saved', 'Dhan credentials updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSavingDhan(false);
    }
  };

  const handleTestIp = async () => {
    setTestingIp(true);
    try {
      const result = await userApi.testIp();
      Alert.alert(
        'IPv6 Binding Test',
        `${result.bound_ipv6 ? '✅ ' : '⚠️ '}${result.bound_ipv6 || 'No IPv6'}\n\n${result.status}`,
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      Alert.alert('Error', 'Failed to test IPv6: ' + (err.message ?? 'Unknown error'));
    } finally {
      setTestingIp(false);
    }
  };

  const handleRefreshDhan = async () => {
    if (!dhan) {
      Alert.alert('No credentials', 'No Dhan credentials saved to refresh.');
      return;
    }
    setRefreshingDhan(true);
    try {
      const res = await userApi.refreshDhanToken();
      if (res.refreshed === 'success') {
        Alert.alert('Refreshed', `Token refreshed at ${formatDateIST(res.refreshed_at ?? new Date().toISOString())}`);
      } else {
        Alert.alert('Refresh failed', res.reason ?? 'Unknown error');
      }
      const latest = await userApi.getDhanCredential();
      setDhan(latest);
      await refreshUser?.();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Unknown error');
    } finally {
      setRefreshingDhan(false);
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
          // Navigate to login after logout completes
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Profile</Text>

        {/* User info */}
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.role === 'admin' && (
            <View style={styles.adminBadge}><Text style={styles.adminText}>ADMIN</Text></View>
          )}
        </View>

        {/* IPv6 info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Placement IP</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Assigned IPv6</Text>
            <Text style={styles.monoValue}>
              {user?.assigned_ipv6 ?? 'Not assigned yet — contact admin'}
            </Text>
          </View>
          {!user?.assigned_ipv6 && (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                ⚠️ No IPv6 assigned. Orders cannot be placed until admin assigns your IP.
              </Text>
            </View>
          )}
        </View>

        {/* Dhan credentials */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Dhan Credentials</Text>
            <TouchableOpacity onPress={() => setShowDhanForm(!showDhanForm)}>
              <Text style={styles.editLink}>{dhan ? 'Update' : 'Add'}</Text>
            </TouchableOpacity>
          </View>

          {dhan && !showDhanForm ? (
            <View style={styles.dhanInfo}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Client ID</Text>
                <Text style={styles.monoValue}>{dhan.dhan_client_id}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status</Text>
                <View style={styles.badgeRow}>
                  <Text style={[styles.badge, { backgroundColor: dhan.is_active ? Colors.successBg : Colors.errorBg, color: dhan.is_active ? Colors.success : Colors.error }]}> 
                    {dhan.is_active ? 'Active' : 'Inactive'}
                  </Text>
                  {dhan.token_expires_at ? (
                    <Text style={[styles.badge, new Date(dhan.token_expires_at) > new Date() ? styles.liveBadge : styles.expiredBadge]}> 
                      {new Date(dhan.token_expires_at) > new Date() ? `Live — Expires ${formatDateIST(dhan.token_expires_at)}` : `Expired ${formatDateIST(dhan.token_expires_at)}`}
                    </Text>
                  ) : (
                    <Text style={[styles.badge, styles.unknownBadge]}>Expiry unknown</Text>
                  )}
                </View>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Updated</Text>
                <Text style={styles.monoValue}>{formatDateIST(dhan.updated_at)}</Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <TouchableOpacity
                  style={[styles.refreshBtn, refreshingDhan && { opacity: 0.6 }]}
                  onPress={handleRefreshDhan}
                  disabled={refreshingDhan}
                >
                  {refreshingDhan ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Text style={styles.refreshText}>Refresh Token</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : !dhan && !showDhanForm ? (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                ⚠️ No Dhan credentials saved. Tap "Add" to connect your Dhan account.
              </Text>
            </View>
          ) : null}

          {showDhanForm && (
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Dhan Client ID</Text>
                <TextInput
                  style={styles.input}
                  value={dhanForm.dhan_client_id}
                  onChangeText={(v) => setDhanForm((f) => ({ ...f, dhan_client_id: v }))}
                  placeholder="Your Dhan client ID"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Access Token</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80 }]}
                  value={dhanForm.access_token}
                  onChangeText={(v) => setDhanForm((f) => ({ ...f, access_token: v }))}
                  placeholder="Paste your Dhan access token"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>
                  🔒 Your token is encrypted before storage. It is never sent in logs.
                </Text>
              </View>
              <View style={styles.formActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDhanForm(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, savingDhan && { opacity: 0.6 }]}
                  onPress={handleSaveDhan}
                  disabled={savingDhan}
                >
                  {savingDhan
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.saveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Account info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.monoValue}>{user?.phone_number}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.monoValue}>{user?.role}</Text>
          </View>
        </View>

        {/* Test IP */}
        <TouchableOpacity
          style={[styles.testIpBtn, testingIp && { opacity: 0.6 }]}
          onPress={handleTestIp}
          disabled={testingIp}
        >
          {testingIp ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Text style={styles.testIpText}>Test IP</Text>
          )}
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.lg, gap: Spacing.lg },
  pageTitle: { ...Typography.h2 },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.lg, alignItems: 'center', ...Shadow.card, gap: 6,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  name: { ...Typography.h3 },
  email: { ...Typography.bodySmall },
  adminBadge: {
    backgroundColor: Colors.primaryBg, paddingHorizontal: 12, paddingVertical: 3,
    borderRadius: Radius.full, marginTop: 4,
  },
  adminText: { color: Colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  section: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, ...Shadow.card, gap: Spacing.sm,
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...Typography.h3, fontSize: 15 },
  editLink: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  infoLabel: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  monoValue: { fontSize: 13, color: Colors.text, fontWeight: '500', flex: 2, textAlign: 'right' },
  warnBox: { backgroundColor: Colors.warningBg, borderRadius: Radius.sm, padding: Spacing.sm },
  warnText: { fontSize: 13, color: Colors.warning, lineHeight: 18 },
  dhanInfo: { gap: Spacing.sm },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    fontSize: 12,
    fontWeight: '700',
  },
  liveBadge: { backgroundColor: Colors.successBg, color: Colors.success },
  expiredBadge: { backgroundColor: Colors.errorBg, color: Colors.error },
  unknownBadge: { backgroundColor: Colors.infoBg, color: Colors.info },

  form: { gap: Spacing.md, marginTop: 4 },
  field: { gap: 6 },
  label: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: 14, color: Colors.text,
  },
  noteBox: { backgroundColor: Colors.primaryBg, borderRadius: Radius.sm, padding: Spacing.sm },
  noteText: { fontSize: 12, color: Colors.primary },
  formActions: { flexDirection: 'row', gap: Spacing.sm },
  cancelBtn: {
    flex: 1, paddingVertical: 11, borderRadius: Radius.sm, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  saveBtn: {
    flex: 1, paddingVertical: 11, borderRadius: Radius.sm, alignItems: 'center',
    backgroundColor: Colors.primary,
  },
  saveText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  testIpBtn: {
    backgroundColor: Colors.primaryBg, borderRadius: Radius.sm,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  testIpText: { color: Colors.primary, fontSize: 16, fontWeight: '700' },

  refreshBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingVertical: 10, alignItems: 'center', paddingHorizontal: 12, marginTop: 4,
  },
  refreshText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  logoutBtn: {
    backgroundColor: Colors.errorBg, borderRadius: Radius.sm,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  logoutText: { color: Colors.error, fontSize: 16, fontWeight: '700' },
});

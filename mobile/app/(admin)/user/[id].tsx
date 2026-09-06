import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';
import { formatDateIST } from '../../../utils/time';
import type { AdminUser } from '../../../types';

export default function UserDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ipv6, setIpv6] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [creditsInput, setCreditsInput] = useState('');
  const [addingCredits, setAddingCredits] = useState(false);
  const [dhanIp, setDhanIp] = useState<{
    assigned_ipv6: string | null;
    dhan_primary_ip: string | null;
    matches: boolean;
  } | null>(null);
  const [checkingIp, setCheckingIp] = useState(false);
  const [fixingIp, setFixingIp] = useState(false);

  useEffect(() => {
    if (!id) return;
    adminApi.getUser(Number(id))
      .then((u) => {
        setUser(u);
        setIpv6(u.assigned_ipv6 ?? '');
        setIsActive(u.is_active);
        setRole(u.role as 'user' | 'admin');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await adminApi.updateUser(Number(id), {
        assigned_ipv6: ipv6.trim() || null,
        is_active: isActive,
        role,
      });
      setUser(updated);
      Alert.alert('Saved', 'User updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCheckDhanIp = async () => {
    setCheckingIp(true);
    try {
      const result = await adminApi.getUserDhanIp(Number(id));
      setDhanIp(result);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setCheckingIp(false);
    }
  };

  const handleFixDhanIp = async () => {
    setFixingIp(true);
    try {
      const result = await adminApi.registerUserDhanIp(Number(id));
      if (result.action === 'cooldown_blocked') {
        Alert.alert('Cannot change yet', result.detail ?? `Dhan allows changing the IP again on ${result.modify_allowed_from}.`);
      } else if (result.action === 'already_correct') {
        Alert.alert('Already correct', `Dhan's primary IP already matches: ${result.dhan_primary_ip}`);
      } else {
        Alert.alert('✅ IP registered with Dhan', `${result.dhan_primary_ip_before ?? 'none'} → ${result.dhan_primary_ip_after}`);
      }
      setDhanIp({
        assigned_ipv6: result.assigned_ipv6,
        dhan_primary_ip: result.dhan_primary_ip_after ?? result.dhan_primary_ip ?? null,
        matches: (result.dhan_primary_ip_after ?? result.dhan_primary_ip) === result.assigned_ipv6,
      });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setFixingIp(false);
    }
  };

  const handleAddCredits = async () => {
    const amount = parseInt(creditsInput, 10);
    if (!amount || amount < 1) {
      Alert.alert('Invalid amount', 'Please enter a positive number.');
      return;
    }
    setAddingCredits(true);
    try {
      const updated = await adminApi.addUserCredits(Number(id), amount);
      setUser(updated);
      setCreditsInput('');
      Alert.alert('✅ Credits added', `Added ${amount} credit(s). User now has ${updated.credits} credit(s).`);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setAddingCredits(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text>User not found.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle} numberOfLines={1}>Edit User</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* User summary */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          <Text style={styles.userPhone}>{user.phone_number}</Text>
          <Text style={styles.joinDate}>Joined {formatDateIST(user.created_at)}</Text>
        </View>

        {/* Editable fields */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>IPv6 Assignment</Text>
          <Text style={styles.helperText}>
            This address must be active on the EC2 instance AND registered in Dhan's developer portal for this user's account.
          </Text>
          <TextInput
            style={styles.input}
            value={ipv6}
            onChangeText={setIpv6}
            placeholder="e.g. 2406:da1a:c1e:f000:abcd::1"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
          />
          {!ipv6 && (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>⚠️ No IPv6 — user cannot receive or confirm signals until assigned.</Text>
            </View>
          )}
        </View>

        {user.has_dhan_credential && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dhan Static IP</Text>
            <Text style={styles.helperText}>
              Compares our assigned IPv6 against the primary static IP currently registered with Dhan for this account.
            </Text>

            {dhanIp && (
              <View style={{ marginBottom: Spacing.sm }}>
                <InfoRow label="Assigned IPv6 (our DB)" value={dhanIp.assigned_ipv6 ?? '—'} mono />
                <InfoRow label="Dhan Primary IP" value={dhanIp.dhan_primary_ip ?? '(not set)'} mono />
                <InfoRow label="Match" value={dhanIp.matches ? '✅ Yes' : '❌ Mismatch'} />
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity
                style={[styles.ipActionBtn, checkingIp && { opacity: 0.6 }]}
                onPress={handleCheckDhanIp}
                disabled={checkingIp}
              >
                {checkingIp ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={styles.ipActionText}>Check Dhan IP</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ipActionBtn, styles.ipFixBtn, fixingIp && { opacity: 0.6 }]}
                onPress={handleFixDhanIp}
                disabled={fixingIp}
              >
                {fixingIp ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.ipActionText, { color: '#fff' }]}>Register / Fix with Dhan</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trading Credits</Text>
          <Text style={styles.helperText}>
            Each successful order placement costs 1 credit. Failed orders refund the credit.
          </Text>
          <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 6 }}>Current: {user?.credits ?? 0} credits</Text>
              <TextInput
                style={styles.input}
                value={creditsInput}
                onChangeText={setCreditsInput}
                placeholder="Add credits (e.g. 5)"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                editable={!addingCredits}
              />
            </View>
            <TouchableOpacity
              style={[styles.addCreditsBtn, addingCredits && { opacity: 0.6 }]}
              onPress={handleAddCredits}
              disabled={addingCredits}
            >
              {addingCredits ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addCreditsBtnText}>Add</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Role</Text>
          <View style={styles.toggleRow}>
            {(['user', 'admin'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.roleBtn, role === r && styles.roleBtnActive]}
                onPress={() => setRole(r)}
              >
                <Text style={[styles.roleText, role === r && styles.roleTextActive]}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.sectionTitle}>Account Active</Text>
              <Text style={styles.helperText}>Inactive users cannot login or place orders.</Text>
            </View>
            <Switch
              value={isActive}
              onValueChange={setIsActive}
              trackColor={{ false: Colors.border, true: Colors.primaryLight }}
              thumbColor={isActive ? Colors.primary : Colors.textMuted}
            />
          </View>
        </View>

        {/* Read-only info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Info</Text>
          <InfoRow label="Dhan Credential" value={user.has_dhan_credential ? '✅ Set' : '❌ Not set'} />
          <InfoRow label="Email" value={user.email} mono />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Changes</Text>}
        </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, color: Colors.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text, fontFamily: mono ? 'monospace' : undefined }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600', width: 60 },
  pageTitle: { ...Typography.h3, flex: 1, textAlign: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg },
  userCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.lg, alignItems: 'center', ...Shadow.card, gap: 4,
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  userName: { ...Typography.h3 },
  userEmail: { ...Typography.bodySmall },
  userPhone: { ...Typography.caption },
  joinDate: { ...Typography.caption, marginTop: 2 },
  section: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, ...Shadow.card, gap: Spacing.sm,
  },
  sectionTitle: { ...Typography.h3, fontSize: 15 },
  helperText: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: 14, color: Colors.text,
    fontFamily: 'monospace',
  },
  warnBox: { backgroundColor: Colors.warningBg, borderRadius: Radius.sm, padding: Spacing.sm },
  warnText: { fontSize: 12, color: Colors.warning },
  toggleRow: { flexDirection: 'row', gap: Spacing.sm },
  roleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  roleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  roleText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  roleTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingVertical: 15, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ipActionBtn: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.sm, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  ipFixBtn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ipActionText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  addCreditsBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 12, borderRadius: Radius.sm,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  addCreditsBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import { formatDateTimeIST } from '../../utils/time';
import EmptyState from '../../components/EmptyState';
import Pagination from '../../components/Pagination';
import { Feather } from '@expo/vector-icons';
import type { AdminUser, PaginationMeta } from '../../types';

export default function AdminApprovalsScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (targetPage: number) => {
    try {
      const data = await adminApi.getUsers({ page: targetPage, isActive: false });
      setUsers(data.items);
      setMeta(data.meta);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const handleRefresh = () => { setRefreshing(true); load(page); };

  const handleApprove = (u: AdminUser) => {
    Alert.alert('Approve User', `Approve "${u.name}"? They'll be able to sign in and will be assigned an IPv6.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setBusyId(u.id);
          try {
            await adminApi.approveUser(u.id);
            load(page);
          } catch (err: any) { Alert.alert('Error', err.message); }
          finally { setBusyId(null); }
        },
      },
    ]);
  };

  const handleReject = (u: AdminUser) => {
    Alert.alert('Reject User', `Permanently delete "${u.name}"'s registration?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject', style: 'destructive',
        onPress: async () => {
          setBusyId(u.id);
          try {
            await adminApi.deleteUser(u.id);
            load(page);
          } catch (err: any) { Alert.alert('Error', err.message); }
          finally { setBusyId(null); }
        },
      },
    ]);
  };

  const renderItem = ({ item: u }: { item: AdminUser }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarChar}>{u.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{u.name}</Text>
          <Text style={styles.userEmail}>{u.email}</Text>
          <Text style={styles.userMeta}>{u.phone_number} · Requested {formatDateTimeIST(u.created_at)}</Text>
        </View>
      </View>

      {busyId === u.id ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.rejectBtn} onPress={() => handleReject(u)}>
            <Feather name="x" size={14} color={Colors.error} />
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(u)}>
            <Feather name="check" size={14} color="#fff" />
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.pageTitle}>Pending Approval ({meta?.total ?? users.length})</Text>
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, !users.length && { flex: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[Colors.primary]} />}
        ListEmptyComponent={<EmptyState icon="user-check" title="No pending sign-ups" subtitle="New registrations awaiting approval will show up here." />}
        showsVerticalScrollIndicator={false}
      />

      <Pagination meta={meta} onPageChange={setPage} loading={loading} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pageTitle: { ...Typography.h3 },
  list: { padding: Spacing.md, gap: Spacing.sm },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatarSmall: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  avatarChar: { color: Colors.primary, fontSize: 18, fontWeight: '700' },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  userEmail: { ...Typography.caption },
  userMeta: { ...Typography.caption },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingVertical: 8, borderRadius: Radius.sm,
  },
  approveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.errorBg, paddingVertical: 8, borderRadius: Radius.sm,
  },
  rejectText: { color: Colors.error, fontSize: 13, fontWeight: '700' },
});

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';
import EmptyState from '../../components/EmptyState';
import Pagination from '../../components/Pagination';
import DateRangeFilter from '../../components/DateRangeFilter';
import { Feather } from '@expo/vector-icons';
import type { AdminUser, PaginationMeta } from '../../types';

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (targetPage: number, q: string, from: string | null, to: string | null) => {
    try {
      const data = await adminApi.getUsers({ page: targetPage, search: q || undefined, date_from: from, date_to: to });
      setUsers(data.items);
      setMeta(data.meta);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(page, search, dateFrom, dateTo); }, [load, page, search, dateFrom, dateTo]);

  // Debounce search text so we don't fire a request on every keystroke
  const handleSearchChange = (q: string) => {
    setSearchInput(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 400);
  };
  const handleDateChange = (from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };


  const renderItem = ({ item: u }: { item: AdminUser }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/(admin)/user/[id]', params: { id: u.id } })}
      activeOpacity={0.8}
    >
      <View style={styles.cardTop}>
        <View style={styles.avatarSmall}>
          <Text style={styles.avatarChar}>{u.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.userInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.userName}>{u.name}</Text>
            {u.role === 'admin' && (
              <View style={styles.adminBadge}><Text style={styles.adminText}>ADMIN</Text></View>
            )}
            {!u.is_active && (
              <View style={styles.inactiveBadge}><Text style={styles.inactiveText}>INACTIVE</Text></View>
            )}
          </View>
          <Text style={styles.userEmail}>{u.email}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.textMuted} />
      </View>

      <View style={styles.statusRow}>
        <Pill
          icon={u.assigned_ipv6 ? 'check' : 'x'}
          label={u.assigned_ipv6 ? u.assigned_ipv6.split(':').slice(-1)[0] + ' (IPv6)' : 'No IPv6'}
          ok={!!u.assigned_ipv6}
        />
        <Pill icon={u.has_dhan_credential ? 'check' : 'x'} label="Dhan cred" ok={u.has_dhan_credential} />
      </View>
    </TouchableOpacity>
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
        <Text style={styles.pageTitle}>Users ({meta?.total ?? users.length})</Text>
      </View>

      <View style={styles.searchBar}>
        <Feather name="search" size={16} color={Colors.textMuted} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={handleSearchChange}
          placeholder="Search by name or email…"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchInput.length > 0 && (
          <TouchableOpacity onPress={() => handleSearchChange('')}>
            <Feather name="x" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterBar}>
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, !users.length && { flex: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(page, search, dateFrom, dateTo); }} colors={[Colors.primary]} />}
        ListEmptyComponent={<EmptyState icon="users" title="No users found" subtitle={search ? 'Try a different search.' : 'No users have registered yet.'} />}
        showsVerticalScrollIndicator={false}
      />

      <Pagination meta={meta} onPageChange={setPage} loading={loading} />
    </SafeAreaView>
  );
}

function Pill({ icon, label, ok }: { icon: string; label: string; ok: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: ok ? Colors.successBg : Colors.errorBg }]}>
      <Feather name={icon as any} size={11} color={ok ? Colors.success : Colors.error} />
      <Text style={[styles.pillText, { color: ok ? Colors.success : Colors.error }]}>{label}</Text>
    </View>
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
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, margin: Spacing.md,
    borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  filterBar: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.sm },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatarSmall: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  avatarChar: { color: Colors.primary, fontSize: 18, fontWeight: '700' },
  userInfo: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  userEmail: { ...Typography.caption },
  adminBadge: { backgroundColor: Colors.primaryBg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  adminText: { color: Colors.primary, fontSize: 9, fontWeight: '800' },
  inactiveBadge: { backgroundColor: Colors.errorBg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  inactiveText: { color: Colors.error, fontSize: 9, fontWeight: '800' },
  statusRow: { flexDirection: 'row', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { fontSize: 11, fontWeight: '600' },
});

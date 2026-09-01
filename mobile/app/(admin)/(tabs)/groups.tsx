import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Modal, Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../../constants/theme';
import { Feather } from '@expo/vector-icons';
import AdminScreenHeader from '../../../components/AdminScreenHeader';
import type { UserGroup } from '../../../types';

export default function GroupsScreen() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create group modal
  const [createVisible, setCreateVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getGroups();
      setGroups(data);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = () => { setRefreshing(true); load(); };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Name required', 'Please enter a group name.');
      return;
    }
    setCreating(true);
    try {
      await adminApi.createGroup({ name, description: newDesc.trim() || null });
      setCreateVisible(false);
      setNewName('');
      setNewDesc('');
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (g: UserGroup) => {
    Alert.alert(
      'Delete Group',
      `Delete "${g.name}"? This removes all memberships but does not affect existing signals.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await adminApi.deleteGroup(g.id);
              load();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item: g }: { item: UserGroup }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/(admin)/group/[id]', params: { id: g.id } })}
      activeOpacity={0.8}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.groupName}>{g.name}</Text>
        {g.description ? <Text style={styles.groupDesc} numberOfLines={1}>{g.description}</Text> : null}
        <View style={styles.memberBadge}>
          <Feather name="users" size={12} color={Colors.primary} />
          <Text style={styles.memberCount}>{g.member_count} member{g.member_count !== 1 ? 's' : ''}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <TouchableOpacity
          onPress={() => handleDelete(g)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.deleteBtn}
        >
          <Feather name="trash-2" size={16} color={Colors.error} />
        </TouchableOpacity>
        <Feather name="chevron-right" size={18} color={Colors.textMuted} />
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
      <AdminScreenHeader
        title="Groups"
        rightAction={{ icon: 'plus', label: 'New Group', onPress: () => setCreateVisible(true) }}
      />

      <FlatList
        data={groups}
        keyExtractor={(g) => String(g.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, !groups.length && { flex: 1, justifyContent: 'center' }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[Colors.primary]} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="users" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySub}>Create groups to target signals to specific users.</Text>
          </View>
        }
      />

      {/* Create Group Modal */}
      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCreateVisible(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New Group</Text>
          <TextInput
            style={styles.input}
            placeholder="Group name (e.g. VIP)"
            placeholderTextColor={Colors.textMuted}
            value={newName}
            onChangeText={setNewName}
            autoFocus
            autoCapitalize="words"
          />
          <TextInput
            style={[styles.input, { marginTop: Spacing.sm }]}
            placeholder="Description (optional)"
            placeholderTextColor={Colors.textMuted}
            value={newDesc}
            onChangeText={setNewDesc}
            autoCapitalize="sentences"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setCreateVisible(false); setNewName(''); setNewDesc(''); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, creating && { opacity: 0.6 }]} onPress={handleCreate} disabled={creating}>
              {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  pageTitle: { ...Typography.h3 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  createText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  list: { padding: Spacing.md, gap: Spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.md, ...Shadow.card,
  },
  cardLeft: { flex: 1, gap: 4 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  groupName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  groupDesc: { fontSize: 13, color: Colors.textSecondary },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  memberCount: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  deleteBtn: { padding: 4 },
  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary },
  emptySub: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: {
    position: 'absolute', left: Spacing.lg, right: Spacing.lg,
    top: '35%',
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.lg, ...Shadow.card,
  },
  modalTitle: { ...Typography.h3, marginBottom: Spacing.md },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: 15, color: Colors.text,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.sm,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  confirmBtn: {
    flex: 2, paddingVertical: 12, borderRadius: Radius.sm,
    alignItems: 'center', backgroundColor: Colors.primary,
  },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});

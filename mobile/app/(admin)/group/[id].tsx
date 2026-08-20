import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Modal, Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { adminApi } from '../../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow, moderateScale } from '../../../constants/theme';
import { Feather } from '@expo/vector-icons';
import type { UserGroupDetail, AdminUser, Paginated } from '../../../types';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [group, setGroup] = useState<UserGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Add member modal state
  const [addVisible, setAddVisible] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());

  // Rename modal
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await adminApi.getGroup(Number(id));
      setGroup(data);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to load group');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleRemoveMember = (user: AdminUser) => {
    Alert.alert(
      'Remove Member',
      `Remove ${user.name} from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await adminApi.removeGroupMember(Number(id), user.id);
              load();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
    );
  };

  const openAddModal = async () => {
    setSelectedUserIds(new Set());
    setUserSearch('');
    setAddVisible(true);
    setUsersLoading(true);
    try {
      const res: Paginated<AdminUser> = await adminApi.getUsers({ pageSize: 200, isActive: true });
      setAllUsers(res.items);
    } catch {}
    finally { setUsersLoading(false); }
  };

  const handleAddMembers = async () => {
    if (selectedUserIds.size === 0) {
      setAddVisible(false);
      return;
    }
    setAddVisible(false);
    setActionLoading(true);
    try {
      await adminApi.addGroupMembers(Number(id), Array.from(selectedUserIds));
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name) return;
    setRenaming(true);
    try {
      await adminApi.updateGroup(Number(id), { name });
      setRenameVisible(false);
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setRenaming(false);
    }
  };

  // Filter users in add-modal: exclude already-members
  const memberIds = new Set(group?.members.map((m) => m.id) ?? []);
  const filteredUsers = allUsers.filter((u) => {
    if (memberIds.has(u.id)) return false;
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const toggleUser = (uid: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!group) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text style={{ color: Colors.error }}>Group not found.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle} numberOfLines={1}>{group.name}</Text>
        <TouchableOpacity onPress={() => { setRenameValue(group.name); setRenameVisible(true); }}>
          <Feather name="edit-2" size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {group.description ? (
        <View style={styles.descBar}>
          <Text style={styles.descText}>{group.description}</Text>
        </View>
      ) : null}

      <FlatList
        data={group.members}
        keyExtractor={(u) => String(u.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, !group.members.length && { flex: 1 }]}
        ListHeaderComponent={
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{group.members.length} Member{group.members.length !== 1 ? 's' : ''}</Text>
            <TouchableOpacity
              style={[styles.addBtn, actionLoading && { opacity: 0.5 }]}
              onPress={openAddModal}
              disabled={actionLoading}
            >
              <Feather name="user-plus" size={14} color="#fff" />
              <Text style={styles.addBtnText}>Add Members</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item: u }) => (
          <View style={styles.memberRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{u.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{u.name}</Text>
              <Text style={styles.memberEmail}>{u.email}</Text>
              {u.assigned_ipv6 && (
                <Text style={styles.memberIp} numberOfLines={1}>{u.assigned_ipv6}</Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => handleRemoveMember(u)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={actionLoading}
            >
              <Feather name="x" size={18} color={Colors.error} />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="user-x" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No members yet. Tap "Add Members" to add users.</Text>
          </View>
        }
      />

      {/* Add Members Modal */}
      <Modal visible={addVisible} transparent animationType="slide" onRequestClose={() => setAddVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddVisible(false)} />
        <View style={styles.addSheet}>
          <View style={styles.addSheetHeader}>
            <Text style={styles.addSheetTitle}>Add Members</Text>
            <TouchableOpacity onPress={() => setAddVisible(false)}>
              <Feather name="x" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or email..."
            placeholderTextColor={Colors.textMuted}
            value={userSearch}
            onChangeText={setUserSearch}
            autoCorrect={false}
          />
          {usersLoading ? (
            <View style={{ paddingVertical: Spacing.lg, alignItems: 'center' }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {filteredUsers.length === 0 ? (
                <Text style={styles.noUsersText}>
                  {allUsers.length === 0
                    ? 'No eligible users found'
                    : 'All eligible users are already members'}
                </Text>
              ) : filteredUsers.map((u) => {
                const selected = selectedUserIds.has(u.id);
                return (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.userRow, selected && styles.userRowSelected]}
                    onPress={() => toggleUser(u.id)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.userRowInfo}>
                      <Text style={styles.userName}>{u.name}</Text>
                      <Text style={styles.userEmail}>{u.email}</Text>
                    </View>
                    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                      {selected && <Feather name="check" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          <TouchableOpacity
            style={[styles.addConfirmBtn, selectedUserIds.size === 0 && { opacity: 0.5 }]}
            onPress={handleAddMembers}
          >
            <Text style={styles.addConfirmText}>
              {selectedUserIds.size > 0 ? `Add ${selectedUserIds.size} Member${selectedUserIds.size > 1 ? 's' : ''}` : 'Done'}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => setRenameVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRenameVisible(false)} />
        <View style={styles.renameCard}>
          <Text style={styles.modalTitle}>Rename Group</Text>
          <TextInput
            style={styles.input}
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Group name"
            placeholderTextColor={Colors.textMuted}
            autoFocus
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRenameVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.confirmBtn, renaming && { opacity: 0.6 }]} onPress={handleRename} disabled={renaming}>
              {renaming ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmText}>Save</Text>}
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
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600', width: 60 },
  pageTitle: { ...Typography.h3, flex: 1, textAlign: 'center' },
  descBar: { backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  descText: { fontSize: 13, color: Colors.textSecondary },
  list: { padding: Spacing.md, gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionTitle: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '800', color: Colors.primary },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: moderateScale(14), fontWeight: '600', color: Colors.text },
  memberEmail: { fontSize: moderateScale(12), color: Colors.textSecondary },
  memberIp: { fontSize: moderateScale(11), fontFamily: 'monospace', color: Colors.info },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  // Add members modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  addSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.lg, paddingBottom: 36,
  },
  addSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  addSheetTitle: { ...Typography.h3 },
  searchInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: 14,
    color: Colors.text, marginBottom: Spacing.sm,
  },
  noUsersText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: Spacing.md },
  userRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm, marginBottom: 4,
  },
  userRowSelected: { backgroundColor: Colors.primaryBg },
  userRowInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.textSecondary },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  addConfirmBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.primary,
    borderRadius: Radius.sm, paddingVertical: 14, alignItems: 'center',
  },
  addConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Rename modal
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  renameCard: {
    position: 'absolute', left: Spacing.lg, right: Spacing.lg, top: '35%',
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

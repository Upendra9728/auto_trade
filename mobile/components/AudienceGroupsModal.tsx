import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Shadow, moderateScale } from '../constants/theme';
import type { GroupRef } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  groups: GroupRef[];
  signalTitle?: string;
}

export default function AudienceGroupsModal({
  visible,
  onClose,
  groups,
  signalTitle,
}: Props) {
  const [rendered, setRendered] = useState(visible);
  const animOpacity = useRef(new Animated.Value(0)).current;
  const animScale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      animOpacity.setValue(0);
      animScale.setValue(0.92);
      Animated.parallel([
        Animated.timing(animOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(animScale, {
          toValue: 1,
          damping: 18,
          stiffness: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (rendered) {
      Animated.parallel([
        Animated.timing(animOpacity, {
          toValue: 0,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(animScale, {
          toValue: 0.92,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setRendered(false);
      });
    }
  }, [visible, rendered, animOpacity, animScale]);

  if (!rendered) return null;

  return (
    <Modal
      transparent
      visible={rendered}
      onRequestClose={onClose}
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.dimmer, { opacity: animOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              opacity: animOpacity,
              transform: [{ scale: animScale }],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Feather name="layers" size={18} color="#7C3AED" />
            </View>
            <View style={styles.headerTextCol}>
              <Text style={styles.title}>Target Groups</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {signalTitle ? signalTitle : `Signal sent to ${groups.length} group${groups.length === 1 ? '' : 's'}`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <Feather name="x" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Group list */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {groups.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No group details available</Text>
              </View>
            ) : (
              groups.map((group, index) => (
                <View
                  key={group.id}
                  style={[
                    styles.groupRow,
                    index === groups.length - 1 && styles.groupRowLast,
                  ]}
                >
                  <View style={styles.indexCircle}>
                    <Text style={styles.indexText}>{index + 1}</Text>
                  </View>
                  <View style={styles.groupInfo}>
                    <Text style={styles.groupName}>{group.name}</Text>
                    <Text style={styles.groupId}>Group ID: {group.id}</Text>
                  </View>
                  <View style={styles.activePill}>
                    <View style={styles.activeDot} />
                    <Text style={styles.activeText}>Targeted</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {/* Footer note */}
          <View style={styles.footer}>
            <Feather name="info" size={13} color="#6D28D9" style={{ marginTop: 1 }} />
            <Text style={styles.footerText}>
              Only members of {groups.length === 1 ? 'this group' : 'these groups'} received this signal.
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  dimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '75%',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.card,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F3FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  headerTextCol: {
    flex: 1,
  },
  title: {
    fontSize: moderateScale(15),
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    maxHeight: 280,
  },
  listContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  groupRowLast: {
    borderBottomWidth: 0,
  },
  indexCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  indexText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
    color: '#64748B',
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: moderateScale(14),
    fontWeight: '600',
    color: Colors.text,
  },
  groupId: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    marginTop: 1,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7C3AED',
  },
  activeText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
    color: '#6D28D9',
  },
  emptyWrap: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: moderateScale(13),
    color: Colors.textMuted,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: '#FAF5FF',
    borderTopWidth: 1,
    borderTopColor: '#F3E8FF',
  },
  footerText: {
    flex: 1,
    fontSize: moderateScale(11),
    color: '#6D28D9',
    lineHeight: 16,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, moderateScale } from '../constants/theme';
import type { GroupRef } from '../types';

interface Props {
  targetGroupIds?: number[] | null;
  targetGroups?: GroupRef[] | null;
  onPressGroups?: (groups: GroupRef[]) => void;
  size?: 'sm' | 'md';
}

export default function AudienceBadge({
  targetGroupIds,
  targetGroups,
  onPressGroups,
  size = 'md',
}: Props) {
  const isSmall = size === 'sm';
  const isGroupTargeted = Boolean(targetGroupIds && targetGroupIds.length > 0);

  if (!isGroupTargeted) {
    return (
      <View style={[styles.allBadge, isSmall && styles.badgeSm]}>
        <Feather name="globe" size={isSmall ? 10 : 11} color="#475569" style={styles.icon} />
        <Text style={[styles.allText, isSmall && styles.textSm]}>All Users</Text>
      </View>
    );
  }

  const groupsList = targetGroups ?? [];
  const hasResolvedGroups = groupsList.length > 0;
  const firstGroupName = hasResolvedGroups
    ? groupsList[0].name
    : targetGroupIds && targetGroupIds.length === 1
    ? '1 Group'
    : `${targetGroupIds?.length ?? 1} Groups`;

  const extraCount = hasResolvedGroups ? groupsList.length - 1 : 0;
  const isPressable = Boolean(onPressGroups && hasResolvedGroups);

  const content = (
    <View style={[styles.groupBadge, isSmall && styles.badgeSm, isPressable && styles.groupBadgePressable]}>
      <Feather name="layers" size={isSmall ? 10 : 11} color="#7C3AED" style={styles.icon} />
      <Text
        style={[styles.groupText, isSmall && styles.textSm]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {firstGroupName}
      </Text>
      {extraCount > 0 && (
        <View style={[styles.extraChip, isSmall && styles.extraChipSm]}>
          <Text style={[styles.extraText, isSmall && styles.extraTextSm]}>+{extraCount}</Text>
        </View>
      )}
      {isPressable && (
        <Feather name="chevron-right" size={isSmall ? 11 : 12} color="#8B5CF6" style={styles.chevron} />
      )}
    </View>
  );

  if (isPressable) {
    return (
      <TouchableOpacity
        onPress={() => onPressGroups?.(groupsList)}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  allBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignSelf: 'flex-start',
  },
  allText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
    color: '#475569',
  },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    alignSelf: 'flex-start',
    maxWidth: 220,
  },
  groupBadgePressable: {
    paddingRight: 6,
  },
  groupText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
    color: '#6D28D9',
    flexShrink: 1,
  },
  extraChip: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.full,
    marginLeft: 4,
  },
  extraChipSm: {
    paddingHorizontal: 4,
    paddingVertical: 0.5,
  },
  extraText: {
    fontSize: moderateScale(10),
    fontWeight: '700',
    color: '#5B21B6',
  },
  extraTextSm: {
    fontSize: moderateScale(9),
  },
  icon: {
    marginRight: 4,
  },
  chevron: {
    marginLeft: 2,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  textSm: {
    fontSize: moderateScale(10),
  },
});

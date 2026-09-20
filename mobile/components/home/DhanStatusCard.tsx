import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, moderateScale, Shadow } from '../../constants/theme';
import { userApi } from '../../services/api';
import type { DhanCredential } from '../../types';

function getDaysUntilExpiry(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export default function DhanStatusCard() {
  const [cred, setCred] = useState<DhanCredential | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    userApi.getDhanCredential()
      .then(c => setCred(c))
      .catch(() => setCred(null))
      .finally(() => setLoading(false));
  }, []);

  const isConnected = cred != null && cred.is_active;
  const daysLeft = getDaysUntilExpiry(cred?.token_expires_at);
  const isExpired = daysLeft !== null && daysLeft <= 0;
  const isGood = isConnected && !isExpired;

  let statusLabel = 'Not Connected';
  let statusSub = 'Tap Profile to configure';

  if (loading) {
    statusLabel = 'Checking...';
    statusSub = '';
  } else if (isConnected && !isExpired) {
    statusLabel = 'Dhan Connected';
    statusSub = daysLeft !== null
      ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
      : 'Broker Connected';
  } else if (isConnected && isExpired) {
    statusLabel = 'Token Expired';
    statusSub = 'Refresh in Profile';
  }

  return (
    <View style={styles.card}>
      {/* Dhan logo "घ" */}
      <View style={[styles.dhanLogo, { backgroundColor: isGood ? '#16A34A' : isExpired ? Colors.error : Colors.textMuted }]}>
        <Text style={styles.dhanLogoText}>घ</Text>
      </View>

      <View style={styles.textGroup}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{statusLabel}</Text>
          <View style={[styles.dot, { backgroundColor: isGood ? '#22C55E' : Colors.error }]} />
        </View>
        {statusSub ? (
          <Text style={styles.sub} numberOfLines={1}>{statusSub}</Text>
        ) : null}
      </View>

      {isExpired && (
        <MaterialIcons name="warning" size={16} color={Colors.warning} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
    gap: Spacing.sm,
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dhanLogo: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dhanLogoText: {
    fontSize: moderateScale(18),
    fontWeight: '800',
    color: '#fff',
  },
  textGroup: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  sub: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    fontWeight: '500',
  },
});

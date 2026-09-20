import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, moderateScale, Shadow } from '../../constants/theme';
import { marketApi, IndexData } from '../../services/api';

const REFRESH_INTERVAL = 30000; // 30 seconds

function formatPrice(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IndexCard({
  label,
  data,
  loading,
}: {
  label: string;
  data?: IndexData;
  loading: boolean;
}) {
  const isPositive = (data?.change ?? 0) >= 0;
  const changeColor = isPositive ? Colors.success : Colors.error;
  const arrow = isPositive ? 'caret-up' : 'caret-down';

  return (
    <View style={styles.indexCard}>
      <Text style={styles.indexLabel}>{label}</Text>
      {loading && !data ? (
        <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 4 }} />
      ) : data ? (
        <>
          <Text style={styles.indexPrice}>{formatPrice(data.price)}</Text>
          <View style={styles.changeRow}>
            <Ionicons name={arrow as any} size={14} color={changeColor} />
            <Text style={[styles.changeText, { color: changeColor }]}>
              {isPositive ? '+' : ''}{formatPrice(data.change)} ({isPositive ? '+' : ''}{data.change_pct.toFixed(2)}%)
            </Text>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.indexPrice}>—</Text>
          <Text style={[styles.changeText, { color: Colors.textMuted }]}>Unavailable</Text>
        </>
      )}
    </View>
  );
}

interface Props {
  isFocused?: boolean;
}

export default function MarketIndices({ isFocused = true }: Props) {
  const [sensex, setSensex] = useState<IndexData | undefined>();
  const [nifty50, setNifty50] = useState<IndexData | undefined>();
  const [bankNifty, setBankNifty] = useState<IndexData | undefined>();
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      const data = await marketApi.getIndices();
      setSensex(data.sensex);
      setNifty50(data.nifty_50);
      setBankNifty(data.bank_nifty);
      const now = new Date();
      setLastUpdated(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
    } catch {
      // Silently fail — keep showing previous data or dashes
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isFocused) return;
    const id = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [isFocused, fetchData]);

  return (
    <View style={styles.container}>
      <IndexCard label="SENSEX" data={sensex} loading={loading} />
      <View style={styles.divider} />
      <IndexCard label="NIFTY 50" data={nifty50} loading={loading} />
      <View style={styles.divider} />
      <IndexCard label="BANK NIFTY" data={bankNifty} loading={loading} />
      {lastUpdated ? (
        <View style={styles.refreshBadge}>
          <Ionicons name="refresh" size={10} color={Colors.textMuted} />
          <Text style={styles.refreshText}>{lastUpdated}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    ...Shadow.card,
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
  },
  indexCard: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 3,
  },
  divider: {
    width: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.sm,
  },
  indexLabel: {
    fontSize: moderateScale(10),
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  indexPrice: {
    fontSize: moderateScale(17),
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  changeText: {
    fontSize: moderateScale(11),
    fontWeight: '600',
  },
  refreshBadge: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  refreshText: {
    fontSize: 9,
    color: Colors.textMuted,
  },
});

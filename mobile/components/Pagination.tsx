import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/theme';
import type { PaginationMeta } from '../types';

interface Props {
  meta: PaginationMeta | null;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

/** Simple prev/next pager shown below a paginated list. Renders nothing for a single page. */
export default function Pagination({ meta, onPageChange, loading }: Props) {
  if (!meta || meta.total_pages <= 1) return null;

  const canPrev = meta.page > 1 && !loading;
  const canNext = meta.page < meta.total_pages && !loading;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.btn, !canPrev && styles.btnDisabled]}
        onPress={() => canPrev && onPageChange(meta.page - 1)}
        disabled={!canPrev}
      >
        <Feather name="chevron-left" size={16} color={canPrev ? Colors.primary : Colors.textMuted} />
        <Text style={[styles.btnText, !canPrev && styles.btnTextDisabled]}>Prev</Text>
      </TouchableOpacity>

      <View style={styles.info}>
        {loading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Text style={styles.infoText}>
            Page {meta.page} of {meta.total_pages} · {meta.total} total
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.btn, !canNext && styles.btnDisabled]}
        onPress={() => canNext && onPageChange(meta.page + 1)}
        disabled={!canNext}
      >
        <Text style={[styles.btnText, !canNext && styles.btnTextDisabled]}>Next</Text>
        <Feather name="chevron-right" size={16} color={canNext ? Colors.primary : Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  btnTextDisabled: { color: Colors.textMuted },
  info: { flex: 1, alignItems: 'center' },
  infoText: { fontSize: 12, color: Colors.textMuted },
});

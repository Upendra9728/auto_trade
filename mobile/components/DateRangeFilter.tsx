import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/theme';

interface Props {
  dateFrom: string | null;
  dateTo: string | null;
  onChange: (dateFrom: string | null, dateTo: string | null) => void;
}

/** Formats a Date using its local calendar fields (avoids UTC-shift from toISOString). */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function displayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Date-range filter chips (From/To) backed by the native date picker. Values are YYYY-MM-DD IST calendar dates. */
export default function DateRangeFilter({ dateFrom, dateTo, onChange }: Props) {
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);

  const openPicker = (which: 'from' | 'to') => setPicker(which);

  const handlePicked = (event: any, selected?: Date) => {
    const which = picker;
    setPicker(null);
    if (Platform.OS === 'android' && event.type === 'dismissed') return;
    if (!selected || !which) return;
    const key = toDateKey(selected);
    if (which === 'from') onChange(key, dateTo);
    else onChange(dateFrom, key);
  };

  const hasFilter = !!dateFrom || !!dateTo;

  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.chip} onPress={() => openPicker('from')}>
        <Feather name="calendar" size={13} color={dateFrom ? Colors.primary : Colors.textMuted} />
        <Text style={[styles.chipText, dateFrom && styles.chipTextActive]}>
          {dateFrom ? displayLabel(dateFrom) : 'From'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.dash}>–</Text>

      <TouchableOpacity style={styles.chip} onPress={() => openPicker('to')}>
        <Feather name="calendar" size={13} color={dateTo ? Colors.primary : Colors.textMuted} />
        <Text style={[styles.chipText, dateTo && styles.chipTextActive]}>
          {dateTo ? displayLabel(dateTo) : 'To'}
        </Text>
      </TouchableOpacity>

      {hasFilter && (
        <TouchableOpacity style={styles.clearBtn} onPress={() => onChange(null, null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      )}

      {picker && (
        <DateTimePicker
          value={(picker === 'from' ? dateFrom : dateTo) ? new Date(`${(picker === 'from' ? dateFrom : dateTo)}T00:00:00`) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handlePicked}
          maximumDate={new Date()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.sm,
  },
  chipText: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: Colors.primary },
  dash: { color: Colors.textMuted },
  clearBtn: { padding: 4 },
});

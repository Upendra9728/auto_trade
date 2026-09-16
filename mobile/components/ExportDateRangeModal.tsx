import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Colors, Spacing, Radius, Typography, Shadow } from '../constants/theme';
import DateRangeFilter from './DateRangeFilter';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (dateFrom: string | null, dateTo: string | null) => void;
}

export default function ExportDateRangeModal({ visible, onClose, onSubmit }: Props) {
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDateFrom(null);
      setDateTo(null);
    }
  }, [visible]);

  const handleDateChange = (from: string | null, to: string | null) => {
    setDateFrom(from);
    setDateTo(to);
  };

  const handleSubmit = () => {
    onSubmit(dateFrom, dateTo);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalKeyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalShell}>
          <Pressable style={styles.modalBackdrop} onPress={onClose} />

          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Export report</Text>
            </View>

            <Text style={styles.modalText}>
              Select the date range for the exported records.
            </Text>

            <View style={styles.pickerWrap}>
              <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />
            </View>

            <View style={styles.footerRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, (!dateFrom || !dateTo) && styles.primaryBtnDisabled]}
                onPress={handleSubmit}
                disabled={!dateFrom || !dateTo}
              >
                <Text style={styles.primaryBtnText}>Export</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalKeyboardWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalShell: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    padding: Spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    position: 'relative',
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  modalHeader: {
    marginBottom: Spacing.sm,
  },
  modalTitle: {
    ...Typography.h3,
    color: Colors.text,
  },
  modalText: {
    ...Typography.body,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
  },
  pickerWrap: {
    paddingVertical: Spacing.sm,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
  },
  secondaryBtnText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  primaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

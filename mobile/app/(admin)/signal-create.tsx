import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { adminApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography, Shadow } from '../../constants/theme';

const SEGMENTS = ['NSE_FNO', 'BSE_FNO', 'NSE_EQ', 'BSE_EQ'];
const PRODUCT_TYPES = ['INTRADAY', 'CNC', 'MARGIN', 'MTF'];
const ORDER_TYPES = ['LIMIT', 'MARKET'];

export default function SignalCreateScreen() {
  const [entryMode, setEntryMode] = useState<'form' | 'paste'>('form');
  const [rawSignal, setRawSignal] = useState('');
  const [form, setForm] = useState({
    title: '',
    exchange_segment: 'NSE_FNO',
    security_id: '',
    transaction_type: 'BUY' as 'BUY' | 'SELL',
    product_type: 'INTRADAY',
    order_type: 'LIMIT',
    quantity: '',
    price: '',
    target_price: '',
    stop_loss_price: '',
    trailing_jump: '0',
  });
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const parseAndPrefill = () => {
    const lines = rawSignal
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      Alert.alert('Invalid format', 'Please paste at least symbol and strike lines.');
      return;
    }

    const first = lines[0].toUpperCase();
    const second = lines[1].toUpperCase();

    const pickValue = (key: string): string => {
      const row = lines.find((line) => line.toUpperCase().startsWith(`${key}:`));
      if (!row) return '';
      return row.split(':').slice(1).join(':').trim();
    };

    const parsedPrice = pickValue('PRICE');
    const parsedStop = pickValue('STOPLOSS') || pickValue('STOP_LOSS');
    const parsedTarget = pickValue('TARGETS') || pickValue('TARGET');
    const parsedQty = pickValue('QTY') || pickValue('QUANTITY');
    const parsedExpiry = pickValue('EXPIRY');

    const parsedSegment = first.includes('SENSEX') ? 'BSE_FNO' : 'NSE_FNO';
    const parsedDirection = second.endsWith('PE') || second.endsWith('CE') ? 'BUY' : form.transaction_type;

    setForm((prev) => ({
      ...prev,
      title: parsedExpiry ? `${first} ${second} ${parsedExpiry}` : `${first} ${second}`,
      exchange_segment: parsedSegment,
      security_id: second,
      transaction_type: parsedDirection,
      quantity: parsedQty || prev.quantity,
      price: parsedPrice || prev.price,
      target_price: parsedTarget || prev.target_price,
      stop_loss_price: parsedStop || prev.stop_loss_price,
      trailing_jump: prev.trailing_jump || '0',
    }));

    setEntryMode('form');
    Alert.alert('Parsed', 'Signal text parsed and form prefilled. Verify values before broadcasting.');
  };

  const handleCreate = async () => {
    if (!form.title || !form.security_id || !form.quantity || !form.price || !form.target_price || !form.stop_loss_price) {
      Alert.alert('Missing fields', 'Please fill in all required fields.');
      return;
    }

    const payload = {
      title: form.title.trim(),
      exchange_segment: form.exchange_segment,
      security_id: form.security_id.trim(),
      transaction_type: form.transaction_type,
      product_type: form.product_type,
      order_type: form.order_type,
      quantity: parseInt(form.quantity, 10),
      price: parseFloat(form.price),
      target_price: parseFloat(form.target_price),
      stop_loss_price: parseFloat(form.stop_loss_price),
      trailing_jump: parseFloat(form.trailing_jump || '0'),
    };

    if (isNaN(payload.quantity) || isNaN(payload.price) || isNaN(payload.target_price) || isNaN(payload.stop_loss_price)) {
      Alert.alert('Invalid values', 'Price, quantity and stop loss must be valid numbers.');
      return;
    }

    setLoading(true);
    try {
      const signal = await adminApi.createSignal(payload);
      Alert.alert(
        '✅ Signal Sent',
        `"${signal.title}" broadcast to all eligible users.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>New Signal</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, entryMode === 'form' && styles.modeBtnActive]}
              onPress={() => setEntryMode('form')}
            >
              <Text style={[styles.modeBtnText, entryMode === 'form' && styles.modeBtnTextActive]}>Fill Form</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, entryMode === 'paste' && styles.modeBtnActive]}
              onPress={() => setEntryMode('paste')}
            >
              <Text style={[styles.modeBtnText, entryMode === 'paste' && styles.modeBtnTextActive]}>Paste Message</Text>
            </TouchableOpacity>
          </View>

          {entryMode === 'paste' && (
            <View style={styles.pasteCard}>
              <Text style={styles.label}>Paste Signal Message</Text>
              <TextInput
                style={styles.pasteInput}
                value={rawSignal}
                onChangeText={setRawSignal}
                placeholder={'NIFTY\n23800PE\nPRICE: 3\nSTOPLOSS: 0\nTARGETS: 15\nQTY: 1300\nEXPIRY: 2026-07-21\nDhann BO'}
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.parseBtn} onPress={parseAndPrefill}>
                <Text style={styles.parseBtnText}>Parse & Prefill Form</Text>
              </TouchableOpacity>
            </View>
          )}

          <Field label="Signal Title *" value={form.title} onChangeText={set('title')} placeholder='e.g. "NIFTY 24000CE BUY"' />

          {/* Buy/Sell toggle */}
          <View style={styles.field}>
            <Text style={styles.label}>Direction *</Text>
            <View style={styles.toggle}>
              {(['BUY', 'SELL'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.toggleBtn,
                    form.transaction_type === t && (t === 'BUY' ? styles.buyActive : styles.sellActive),
                  ]}
                  onPress={() => set('transaction_type')(t)}
                >
                  <Text style={[styles.toggleText, form.transaction_type === t && { color: '#fff' }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Exchange segment chips */}
          <View style={styles.field}>
            <Text style={styles.label}>Exchange Segment *</Text>
            <View style={styles.chips}>
              {SEGMENTS.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, form.exchange_segment === s && styles.chipActive]}
                  onPress={() => set('exchange_segment')(s)}
                >
                  <Text style={[styles.chipText, form.exchange_segment === s && styles.chipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Field label="Security ID *" value={form.security_id} onChangeText={set('security_id')} placeholder="Dhan numeric security ID" keyboardType="numeric" />
          <Field label="Quantity *" value={form.quantity} onChangeText={set('quantity')} placeholder="50" keyboardType="numeric" />
          <Field label="Entry Price *" value={form.price} onChangeText={set('price')} placeholder="120.50" keyboardType="decimal-pad" />
          <Field label="Target Price *" value={form.target_price} onChangeText={set('target_price')} placeholder="150.00" keyboardType="decimal-pad" />
          <Field label="Stop Loss Price *" value={form.stop_loss_price} onChangeText={set('stop_loss_price')} placeholder="100.00" keyboardType="decimal-pad" />
          <Field label="Trailing Jump" value={form.trailing_jump} onChangeText={set('trailing_jump')} placeholder="0" keyboardType="decimal-pad" />

          {/* Product type chips */}
          <View style={styles.field}>
            <Text style={styles.label}>Product Type</Text>
            <View style={styles.chips}>
              {PRODUCT_TYPES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, form.product_type === p && styles.chipActive]}
                  onPress={() => set('product_type')(p)}
                >
                  <Text style={[styles.chipText, form.product_type === p && styles.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Order type */}
          <View style={styles.field}>
            <Text style={styles.label}>Order Type</Text>
            <View style={styles.chips}>
              {ORDER_TYPES.map((o) => (
                <TouchableOpacity
                  key={o}
                  style={[styles.chip, form.order_type === o && styles.chipActive]}
                  onPress={() => set('order_type')(o)}
                >
                  <Text style={[styles.chipText, form.order_type === o && styles.chipTextActive]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Summary preview */}
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Preview</Text>
            <Text style={styles.previewLine}>
              {form.transaction_type} {form.quantity || '—'} × {form.exchange_segment} / {form.security_id || '—'}
            </Text>
            <Text style={styles.previewLine}>
              Entry ₹{form.price || '—'} · SL ₹{form.stop_loss_price || '—'} · Target ₹{form.target_price || '—'}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.6 }]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitText}>🚀 Broadcast Signal</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default' }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600', width: 60 },
  pageTitle: { ...Typography.h3 },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 6,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: Colors.primary,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  modeBtnTextActive: {
    color: '#fff',
  },
  pasteCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  pasteInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    minHeight: 140,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  parseBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  parseBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  field: { gap: 6 },
  label: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: 15, color: Colors.text,
    backgroundColor: Colors.surface,
  },
  toggle: { flexDirection: 'row', gap: Spacing.sm },
  toggleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  buyActive: { backgroundColor: Colors.buy, borderColor: Colors.buy },
  sellActive: { backgroundColor: Colors.sell, borderColor: Colors.sell },
  toggleText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: '#fff' },
  preview: {
    backgroundColor: Colors.primaryBg, borderRadius: Radius.sm,
    padding: Spacing.md, gap: 4,
  },
  previewTitle: { ...Typography.label, color: Colors.primary, marginBottom: 4 },
  previewLine: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  submitBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingVertical: 16, alignItems: 'center', marginTop: Spacing.sm,
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

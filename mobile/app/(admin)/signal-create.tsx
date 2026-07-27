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

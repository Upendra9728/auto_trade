import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { authApi } from '../../services/api';
import { Colors, Spacing, Radius, Typography } from '../../constants/theme';

export default function RegisterScreen() {
  const [form, setForm] = useState({ name: '', email: '', phone_number: '', password: '' });
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleRegister = async () => {
    if (!form.name || !form.email || !form.phone_number || !form.password) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (form.password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await authApi.register({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone_number: form.phone_number.trim(),
        password: form.password,
      });
      Alert.alert(
        'Account created!',
        'An admin needs to approve your account before you can sign in.',
        [{ text: 'Sign In', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (err: any) {
      Alert.alert('Registration failed', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
      >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join and start trading smarter</Text>
        </View>

        <View style={styles.card}>
          {([
            { key: 'name' as const, label: 'Full Name', placeholder: 'John Doe', type: 'default' as const, secure: false },
            { key: 'email' as const, label: 'Email Address', placeholder: 'you@email.com', type: 'email-address' as const, secure: false },
            { key: 'phone_number' as const, label: 'Phone Number', placeholder: '+91 9876543210', type: 'phone-pad' as const, secure: false },
            { key: 'password' as const, label: 'Password', placeholder: 'Min. 8 characters', type: 'default' as const, secure: true },
          ]).map(({ key, label, placeholder, type, secure }) => (
            <View key={key} style={styles.field}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                style={styles.input}
                value={form[key]}
                onChangeText={set(key)}
                placeholder={placeholder}
                placeholderTextColor={Colors.textMuted}
                keyboardType={type as any}
                secureTextEntry={secure}
                autoCapitalize={key === 'email' ? 'none' : key === 'name' ? 'words' : 'none'}
                autoCorrect={false}
              />
            </View>
          ))}

          <View style={styles.note}>
            <Text style={styles.noteText}>
              � New accounts require admin approval before you can sign in.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.btnText}>{loading ? 'Creating account…' : 'Create Account'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.linkRow} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.link}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, padding: Spacing.lg, paddingBottom: Spacing.xl },
  topBar: { marginBottom: Spacing.md },
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  titleRow: { marginBottom: Spacing.lg },
  title: { ...Typography.h2 },
  subtitle: { ...Typography.bodySmall, marginTop: 4 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    gap: Spacing.md,
  },
  field: { gap: 6 },
  label: { ...Typography.label, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
  },
  note: {
    backgroundColor: Colors.primaryBg,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  noteText: { fontSize: 13, color: Colors.primary, lineHeight: 18 },
  btn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkRow: { alignItems: 'center', marginTop: Spacing.lg },
  linkText: { ...Typography.body, color: Colors.textSecondary },
  link: { color: Colors.primary, fontWeight: '700' },
});

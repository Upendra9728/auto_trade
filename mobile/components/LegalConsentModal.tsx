import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { Colors, Spacing, Radius, Typography, moderateScale } from '../constants/theme';
import { PRIVACY_POLICY } from '../constants/legal/privacy-policy';
import { RISK_DISCLOSURE } from '../constants/legal/risk-disclosure';
import { TERMS_OF_USE } from '../constants/legal/terms-of-use';

export default function LegalConsentModal() {
  const { user, acceptLegal, logout } = useAuth();
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedRisk, setAgreedRisk] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Only show when a user is authenticated but has not yet accepted terms
  const visible = Boolean(user && user.terms_accepted === false);

  if (!visible) return null;

  const allAgreed = agreedPrivacy && agreedRisk && agreedTerms;

  const handleAccept = async () => {
    if (!allAgreed) return;
    setSubmitting(true);
    try {
      await acceptLegal();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save legal acceptance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExit = () => {
    Alert.alert(
      'Exit Application',
      'You must accept the Privacy Policy, Risk Disclosure, and Terms of Use to use Trading Floor. Exiting will log you out.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit & Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
            if (Platform.OS === 'android') {
              BackHandler.exitApp();
            }
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {}}
    >
      <SafeAreaView style={styles.container}>
        {/* Header Bar */}
        <View style={styles.headerBar}>
          <View style={styles.headerLeft}>
            <Feather name="shield" size={20} color={Colors.primary} />
            <Text style={styles.headerTitle}>Legal Agreements</Text>
          </View>
          <TouchableOpacity
            style={styles.exitHeaderBtn}
            onPress={handleExit}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="log-out" size={16} color={Colors.error} />
            <Text style={styles.exitHeaderText}>Exit</Text>
          </TouchableOpacity>
        </View>

        {/* Notice Card */}
        <View style={styles.noticeBox}>
          <Feather name="alert-circle" size={16} color={Colors.warning} style={{ marginTop: 2 }} />
          <Text style={styles.noticeText}>
            Please review the legal agreements below. You must read and accept all three documents to proceed into the application.
          </Text>
        </View>

        {/* Scrollable Document Content */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          {/* 1. Privacy Policy */}
          <View style={styles.docCard}>
            <View style={styles.docHeader}>
              <View style={styles.docNumberBadge}>
                <Text style={styles.docNumberText}>1</Text>
              </View>
              <Text style={styles.docTitle}>Privacy Policy</Text>
            </View>
            <Text style={styles.docBody}>{PRIVACY_POLICY.trim()}</Text>
          </View>

          {/* 2. Risk Disclosure & Order Authorisation */}
          <View style={styles.docCard}>
            <View style={styles.docHeader}>
              <View style={styles.docNumberBadge}>
                <Text style={styles.docNumberText}>2</Text>
              </View>
              <Text style={styles.docTitle}>Risk Disclosure & Order Authorisation</Text>
            </View>
            <Text style={styles.docBody}>{RISK_DISCLOSURE.trim()}</Text>
          </View>

          {/* 3. Terms of Use */}
          <View style={styles.docCard}>
            <View style={styles.docHeader}>
              <View style={styles.docNumberBadge}>
                <Text style={styles.docNumberText}>3</Text>
              </View>
              <Text style={styles.docTitle}>Terms of Use</Text>
            </View>
            <Text style={styles.docBody}>{TERMS_OF_USE.trim()}</Text>
          </View>

          {/* Checkbox Acknowledgement Section */}
          <View style={styles.acknowledgementCard}>
            <Text style={styles.ackHeader}>Acknowledgement & Consent</Text>

            {/* Checkbox 1 */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedPrivacy(!agreedPrivacy)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, agreedPrivacy && styles.checkboxChecked]}>
                {agreedPrivacy && <Feather name="check" size={14} color="#fff" />}
              </View>
              <Text style={styles.checkboxLabel}>
                I have read, understood, and agree to the <Text style={styles.boldText}>Privacy Policy</Text>.
              </Text>
            </TouchableOpacity>

            {/* Checkbox 2 */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedRisk(!agreedRisk)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, agreedRisk && styles.checkboxChecked]}>
                {agreedRisk && <Feather name="check" size={14} color="#fff" />}
              </View>
              <Text style={styles.checkboxLabel}>
                I have read, understood, and accept the <Text style={styles.boldText}>Risk Disclosure & Order Authorisation</Text>.
              </Text>
            </TouchableOpacity>

            {/* Checkbox 3 */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedTerms(!agreedTerms)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, agreedTerms && styles.checkboxChecked]}>
                {agreedTerms && <Feather name="check" size={14} color="#fff" />}
              </View>
              <Text style={styles.checkboxLabel}>
                I have read, understood, and agree to the <Text style={styles.boldText}>Terms of Use</Text>.
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Bottom Actions Bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.exitBtn}
            onPress={handleExit}
            disabled={submitting}
            activeOpacity={0.75}
          >
            <Text style={styles.exitBtnText}>Exit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.acceptBtn,
              (!allAgreed || submitting) && styles.acceptBtnDisabled,
            ]}
            onPress={handleAccept}
            disabled={!allAgreed || submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.acceptBtnText}>Accept & Continue</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerTitle: {
    ...Typography.h3,
    fontSize: moderateScale(17),
  },
  exitHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Radius.sm,
    backgroundColor: Colors.errorBg,
  },
  exitHeaderText: {
    fontSize: moderateScale(12),
    fontWeight: '700',
    color: Colors.error,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.warningBg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  noticeText: {
    flex: 1,
    fontSize: moderateScale(12),
    color: Colors.text,
    lineHeight: 17,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  docCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  docHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  docNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docNumberText: {
    color: '#fff',
    fontSize: moderateScale(12),
    fontWeight: '700',
  },
  docTitle: {
    ...Typography.h3,
    fontSize: moderateScale(15),
    color: Colors.text,
    flex: 1,
  },
  docBody: {
    fontSize: moderateScale(12),
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  acknowledgementCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1.5,
    borderColor: Colors.primaryLight,
    gap: Spacing.sm,
  },
  ackHeader: {
    ...Typography.h3,
    fontSize: moderateScale(14),
    marginBottom: 4,
    color: Colors.text,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: Colors.textMuted,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: moderateScale(13),
    color: Colors.text,
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '700',
    color: Colors.primary,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  exitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitBtnText: {
    fontSize: moderateScale(14),
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtnDisabled: {
    backgroundColor: Colors.textMuted,
    opacity: 0.6,
  },
  acceptBtnText: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: '#fff',
  },
});

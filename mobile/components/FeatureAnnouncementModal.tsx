import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, moderateScale } from '../constants/theme';
import type { FeatureAnnouncement } from '../services/announcements';

interface FeatureAnnouncementModalProps {
  announcement: FeatureAnnouncement | null;
  visible: boolean;
  onCta: () => void;
  onDismiss: () => void;
}

export default function FeatureAnnouncementModal({
  announcement,
  visible,
  onCta,
  onDismiss,
}: FeatureAnnouncementModalProps) {
  if (!visible || !announcement) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header Tag / Badge */}
          {announcement.tag ? (
            <View style={styles.tagBadge}>
              <Feather name="zap" size={11} color="#fff" style={{ marginRight: 4 }} />
              <Text style={styles.tagText}>{announcement.tag}</Text>
            </View>
          ) : null}

          {/* Icon Circle */}
          <View style={styles.iconCircle}>
            <Feather name="gift" size={28} color={Colors.primary} />
          </View>

          {/* Title & Message */}
          <Text style={styles.title}>{announcement.title}</Text>
          <Text style={styles.message}>{announcement.message}</Text>

          {/* Feature Bullets */}
          {announcement.bullets && announcement.bullets.length > 0 ? (
            <View style={styles.bulletsList}>
              {announcement.bullets.map((b, idx) => (
                <View key={idx} style={styles.bulletRow}>
                  <View style={styles.bulletIconWrap}>
                    <Feather name={b.icon} size={15} color={Colors.primary} />
                  </View>
                  <View style={styles.bulletTextWrap}>
                    <Text style={styles.bulletTitle}>{b.title}</Text>
                    {b.description ? (
                      <Text style={styles.bulletDesc}>{b.description}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={onCta}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaText}>{announcement.ctaText}</Text>
              <Feather name="arrow-right" size={16} color="#fff" style={{ marginLeft: 6 }} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dismissButton}
              onPress={onDismiss}
              activeOpacity={0.7}
            >
              <Text style={styles.dismissText}>
                {announcement.dismissText || 'Got It'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    zIndex: 9999,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 390,
    alignItems: 'center',
    ...Shadow.card,
    elevation: 10,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  tagText: {
    color: '#fff',
    fontSize: moderateScale(10),
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  iconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: moderateScale(19),
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  message: {
    fontSize: moderateScale(13),
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: Spacing.md,
    paddingHorizontal: 4,
  },
  bulletsList: {
    width: '100%',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 10,
    marginBottom: Spacing.lg,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  bulletTextWrap: {
    flex: 1,
  },
  bulletTitle: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  bulletDesc: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  actions: {
    width: '100%',
    gap: 8,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 13,
    borderRadius: Radius.md,
    width: '100%',
  },
  ctaText: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '700',
  },
  dismissButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  dismissText: {
    color: Colors.textMuted,
    fontSize: moderateScale(13),
    fontWeight: '600',
  },
});

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useUpdate } from '../contexts/UpdateContext';
import { Colors, Radius, Shadow, Spacing, moderateScale } from '../constants/theme';

export default function UpdateModal() {
  const {
    modalVisible,
    latestVersion,
    currentVersion,
    forceUpdate,
    releaseNotes,
    isDownloading,
    downloadProgress,
    closeModal,
    triggerDownload,
  } = useUpdate();

  if (!modalVisible) return null;

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="fade"
      onRequestClose={closeModal}
    >
      <View style={styles.backdrop}>
        {/* Updates are mandatory — backdrop tap does nothing */}
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            {isDownloading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Feather name="download-cloud" size={30} color={Colors.primary} />
            )}
          </View>

          <Text style={styles.title}>
            {isDownloading ? 'Downloading Update…' : 'Update Available'}
          </Text>
          <Text style={styles.message}>
            {isDownloading
              ? 'Please wait while the update is downloading. The installation prompt will open automatically.'
              : 'A newer version of the app is available. Update now to ensure seamless trading operations and get the latest features.'}
          </Text>

          {isDownloading ? (
            <View style={styles.progressSection}>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.round(downloadProgress * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {Math.round(downloadProgress * 100)}%
              </Text>
            </View>
          ) : (
            <View style={styles.versionBox}>
              <View style={styles.versionCol}>
                <Text style={styles.versionLabel}>Current</Text>
                <Text style={styles.versionValue}>v{currentVersion}</Text>
              </View>
              <Feather name="arrow-right" size={16} color={Colors.textMuted} />
              <View style={styles.versionCol}>
                <Text style={styles.versionLabel}>New</Text>
                <Text style={[styles.versionValue, { color: Colors.success }]}>
                  v{latestVersion ?? 'Latest'}
                </Text>
              </View>
            </View>
          )}

          {!isDownloading && releaseNotes && (
            <View style={styles.releaseNotesSection}>
              <Text style={styles.releaseNotesTitle}>What's New</Text>
              {releaseNotes.split('\n').map((note, idx) => (
                <View key={idx} style={styles.bulletPoint}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.bulletText}>{note.trim()}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.btnRow}>
            {/* No 'Later' button — all updates are mandatory */}

            <TouchableOpacity
              style={[
                styles.downloadBtn,
                { flex: 1 },
                isDownloading && { opacity: 0.8 },
              ]}
              onPress={triggerDownload}
              disabled={isDownloading}
              activeOpacity={0.85}
            >
              {isDownloading ? (
                <Text style={styles.downloadBtnText}>
                  Downloading… ({Math.round(downloadProgress * 100)}%)
                </Text>
              ) : (
                <>
                  <Feather name="download" size={16} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.downloadBtnText}>Download & Install</Text>
                </>
              )}
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    zIndex: 10000,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    ...Shadow.card,
    elevation: 10,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: moderateScale(18),
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  message: {
    fontSize: moderateScale(13),
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: Spacing.md,
  },
  versionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    width: '100%',
    marginBottom: Spacing.lg,
  },
  versionCol: {
    alignItems: 'center',
  },
  versionLabel: {
    fontSize: moderateScale(11),
    color: Colors.textMuted,
    marginBottom: 2,
  },
  versionValue: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: Colors.text,
  },
  progressSection: {
    width: '100%',
    marginBottom: Spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.background,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  progressText: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    width: '100%',
  },
  laterBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterBtnText: {
    fontSize: moderateScale(14),
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  downloadBtn: {
    flex: 1.5,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBtnText: {
    fontSize: moderateScale(14),
    fontWeight: '700',
    color: '#fff',
  },
  releaseNotesSection: {
    width: '100%',
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  releaseNotesTitle: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  bulletPoint: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bullet: {
    fontSize: moderateScale(13),
    color: Colors.primary,
    marginRight: 8,
    fontWeight: '700',
  },
  bulletText: {
    fontSize: moderateScale(12),
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },
});

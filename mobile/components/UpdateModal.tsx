import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
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
        {!forceUpdate && (
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
        )}
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <View style={styles.iconCircle}>
            <Feather name="download-cloud" size={30} color={Colors.primary} />
          </View>

          <Text style={styles.title}>Update Available</Text>
          <Text style={styles.message}>
            A newer version of the app is available. Update now to ensure seamless trading operations and get the latest features.
          </Text>

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

          <View style={styles.btnRow}>
            {!forceUpdate && (
              <TouchableOpacity
                style={styles.laterBtn}
                onPress={closeModal}
                activeOpacity={0.7}
              >
                <Text style={styles.laterBtnText}>Later</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.downloadBtn, forceUpdate && { flex: 1 }]}
              onPress={triggerDownload}
              activeOpacity={0.85}
            >
              <Feather name="download" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.downloadBtnText}>Download</Text>
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
});

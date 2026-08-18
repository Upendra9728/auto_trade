import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useUpdate } from '../contexts/UpdateContext';
import { Colors, Radius, Shadow, moderateScale } from '../constants/theme';

export default function UpdateBadge() {
  const { updateAvailable, latestVersion, isDismissed, forceUpdate, openModal, dismissBadge } = useUpdate();
  const insets = useSafeAreaInsets();

  if (!updateAvailable || (isDismissed && !forceUpdate)) {
    return null;
  }

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 10 : 0);

  return (
    <View style={[styles.wrapper, { top: topInset + 6 }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.container}
        onPress={openModal}
        activeOpacity={0.88}
      >
        <View style={styles.left}>
          <View style={styles.iconCircle}>
            <Feather name="arrow-up-circle" size={16} color="#fff" />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              Update Available {latestVersion ? `(v${latestVersion})` : ''}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              Tap to download the latest version
            </Text>
          </View>
        </View>

        {!forceUpdate && (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={dismissBadge}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    alignItems: 'center',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primaryLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: '100%',
    ...Shadow.card,
    elevation: 8,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: moderateScale(13),
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: moderateScale(11),
    color: Colors.textSecondary,
    marginTop: 1,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
});

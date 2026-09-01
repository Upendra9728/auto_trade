import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { Colors, Radius, Shadow, Spacing, moderateScale } from '../constants/theme';

export default function CreditsBanner() {
  const { user, refreshUser } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);
  const appState = useRef(AppState.currentState);
  const insets = useSafeAreaInsets();
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Show banner if user has 0 credits and hasn't dismissed it
  const hasNoCredits = user && user.credits === 0;
  const shouldShow = hasNoCredits && !isDismissed;

  // Reset dismissal state when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to foreground — reset dismissal
        setIsDismissed(false);
        // Refresh user to get latest credit balance
        refreshUser().catch(() => {});
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [refreshUser]);

  // Refresh user credits periodically (every 60s) to catch admin top-ups
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => {
      refreshUser().catch(() => {});
    }, 60 * 1000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [refreshUser]);

  if (!shouldShow) {
    return null;
  }

  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 10 : 0);

  return (
    <View style={[styles.wrapper, { top: topInset + 6 }]} pointerEvents="box-none">
      <View style={styles.container}>
        <View style={styles.left}>
          <View style={styles.iconCircle}>
            <Feather name="alert-circle" size={16} color="#fff" />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              No Trading Credits
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              You will not receive new trading signals.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => setIsDismissed(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="x" size={16} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>
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
    borderColor: '#FF6B6B',
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
    backgroundColor: '#FF6B6B',
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

import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  View,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { userApi } from '../services/api';
import { Colors, Radius } from '../constants/theme';

export default function TelegramAutomationToggle() {
  const { user, refreshUser } = useAuth();
  const [saving, setSaving] = useState(false);

  // Non-admins do not see this control
  if (!user || user.role !== 'admin') return null;

  const isEnabled = Boolean(user.telegram_automation_enabled);

  const applyToggle = async (nextState: boolean) => {
    setSaving(true);
    try {
      await userApi.updateProfile({
        telegram_automation_enabled: nextState,
      });
      await refreshUser();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to update Telegram automation setting');
    } finally {
      setSaving(false);
    }
  };

  const handlePress = () => {
    if (saving) return;

    if (isEnabled) {
      Alert.alert(
        'Turn Off Telegram Automation?',
        'Incoming signals received from Telegram channels will be ignored until you turn this back on.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Turn Off',
            style: 'destructive',
            onPress: () => applyToggle(false),
          },
        ],
      );
    } else {
      void applyToggle(true);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.pill,
        isEnabled ? styles.pillOn : styles.pillOff,
      ]}
      onPress={handlePress}
      disabled={saving}
      activeOpacity={0.8}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityLabel={`Telegram Automation ${isEnabled ? 'ON' : 'OFF'}`}
    >
      {saving ? (
        <ActivityIndicator size="small" color={isEnabled ? '#0088CC' : Colors.textMuted} />
      ) : (
        <>
          <View style={[styles.iconCircle, isEnabled ? styles.iconCircleOn : styles.iconCircleOff]}>
            <FontAwesome5
              name="telegram-plane"
              size={11}
              color={isEnabled ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>
          <Text style={[styles.text, isEnabled ? styles.textOn : styles.textOff]}>
            {isEnabled ? 'TG ON' : 'TG OFF'}
          </Text>
          <View style={[styles.dot, isEnabled ? styles.dotOn : styles.dotOff]} />
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  pillOn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#0088CC',
  },
  pillOff: {
    backgroundColor: '#F3F4F6',
    borderColor: Colors.border,
  },
  iconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleOn: {
    backgroundColor: '#0088CC',
  },
  iconCircleOff: {
    backgroundColor: '#E5E7EB',
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  textOn: {
    color: '#0088CC',
  },
  textOff: {
    color: Colors.textMuted,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOn: {
    backgroundColor: Colors.success,
  },
  dotOff: {
    backgroundColor: '#D1D5DB',
  },
});

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

/**
 * Absolutely-positioned pulsing colored border overlay. Render as the first
 * child of a `position: relative` container with matching borderRadius.
 */
export default function GlowBorder({ color, borderRadius = 12 }: { color: string; borderRadius?: number }) {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          borderRadius,
          borderWidth: 2,
          borderColor: color,
          opacity: pulse,
        },
      ]}
    />
  );
}

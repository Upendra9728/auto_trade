import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet, AccessibilityInfo } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '../constants/theme';

const BAR_COUNT = 22;
const BAR_MAX = 42;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v: boolean) => { if (mounted) setReduce(v); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  return reduce;
}

function pingPong(value: Animated.Value, duration: number, delay = 0): Animated.CompositeAnimation {
  return Animated.sequence([
    Animated.delay(delay),
    Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ),
  ]);
}

/** Decorative animated backdrop for a rounded, overflow-hidden hero card. Pauses while the screen is unfocused. */
export default function HeroBackground() {
  const reduceMotion = useReduceMotion();

  const orbA = useRef(new Animated.Value(0)).current;
  const orbB = useRef(new Animated.Value(0)).current;
  const orbC = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0))).current;

  const barHeights = useMemo(
    () => Array.from({ length: BAR_COUNT }, (_, i) => Math.round(BAR_MAX * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7))))),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) return undefined;

      const animations: Animated.CompositeAnimation[] = [
        pingPong(orbA, 6500),
        pingPong(orbB, 8000, 800),
        pingPong(orbC, 5200, 400),
        Animated.loop(
          Animated.sequence([
            Animated.timing(sweep, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.delay(4800),
          ]),
        ),
        ...bars.map((v, i) => pingPong(v, 1100 + (i % 6) * 260, (i * 137) % 900)),
      ];
      animations.forEach((a) => a.start());
      return () => animations.forEach((a) => a.stop());
    }, [reduceMotion, orbA, orbB, orbC, sweep, bars]),
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.orb, styles.orbA,
          {
            transform: [
              { translateX: orbA.interpolate({ inputRange: [0, 1], outputRange: [-14, 16] }) },
              { translateY: orbA.interpolate({ inputRange: [0, 1], outputRange: [8, -12] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb, styles.orbB,
          {
            transform: [
              { translateX: orbB.interpolate({ inputRange: [0, 1], outputRange: [12, -16] }) },
              { translateY: orbB.interpolate({ inputRange: [0, 1], outputRange: [-8, 12] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb, styles.orbC,
          {
            opacity: orbC.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
            transform: [{ scale: orbC.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.sweep,
          {
            transform: [
              { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-120, Screen.width + 60] }) },
              { rotate: '18deg' },
            ],
          },
        ]}
      />

      <View style={styles.barsRow}>
        {bars.map((v, i) => (
          <View key={i} style={[styles.barSlot, { height: barHeights[i] }]}>
            <Animated.View
              style={[
                styles.bar,
                {
                  height: barHeights[i],
                  transform: [
                    { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [barHeights[i] * 0.6, 0] }) },
                  ],
                },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Small green dot with an expanding ring, used to signal live activity. */
export function PulseDot({ color = '#4ADE80', size = 8 }: { color?: string; size?: number }) {
  const ring = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) return undefined;
      const anim = Animated.loop(
        Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      );
      anim.start();
      return () => anim.stop();
    }, [reduceMotion, ring]),
  );

  return (
    <View style={{ width: size * 2.6, height: size * 2.6, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  orb: { position: 'absolute', borderRadius: 999 },
  orbA: { width: 170, height: 170, top: -60, right: -40, backgroundColor: 'rgba(96,165,250,0.28)' },
  orbB: { width: 130, height: 130, bottom: -50, left: -30, backgroundColor: 'rgba(59,130,246,0.30)' },
  orbC: { width: 70, height: 70, top: 26, left: '45%', backgroundColor: 'rgba(147,197,253,0.14)' },
  sweep: {
    position: 'absolute',
    top: -40,
    width: 54,
    height: 260,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  barsRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    height: BAR_MAX,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    opacity: 0.55,
  },
  barSlot: { width: 6, overflow: 'hidden', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  bar: { position: 'absolute', bottom: 0, width: 6, backgroundColor: 'rgba(255,255,255,0.16)' },
});

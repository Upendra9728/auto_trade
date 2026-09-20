import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Shadow, moderateScale } from '../../constants/theme';

export default function DisciplinedBanner() {
  return (
    <View style={styles.card}>
      {/* Left content */}
      <View style={styles.left}>
        <Text style={styles.headline}>Disciplined Signals</Text>
        <Text style={styles.headlineSub}>for a Better Trading You</Text>
        <Text style={styles.body}>Real-time analysis. Actionable ideas. Your edge.</Text>
      </View>

      {/* Right content */}
      <View style={styles.right}>
        {/* Chart icon */}
        <View style={styles.chartIcon}>
          <Ionicons name="trending-up" size={40} color="rgba(255,255,255,0.3)" />
          {/* Mini bar chart graphic */}
          <View style={styles.miniChart}>
            <View style={[styles.miniBar, { height: 10 }]} />
            <View style={[styles.miniBar, { height: 16 }]} />
            <View style={[styles.miniBar, { height: 12 }]} />
            <View style={[styles.miniBar, { height: 22 }]} />
            <View style={[styles.miniBar, { height: 18 }]} />
          </View>
        </View>
        {/* Vertical labels */}
        <View style={styles.vertLabels}>
          {['ANALYSE', 'PLAN', 'TRADE', 'GROW'].map((label) => (
            <Text key={label} style={styles.vertLabel}>{label}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingVertical: 16,
    // Deep blue gradient via layered backgrounds
    backgroundColor: '#1E3A8A',
    ...Shadow.card,
  },
  left: {
    flex: 1,
    gap: 4,
    paddingRight: 12,
  },
  headline: {
    fontSize: moderateScale(17),
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headlineSub: {
    fontSize: moderateScale(16),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: -0.2,
    marginTop: -2,
  },
  body: {
    fontSize: moderateScale(10.5),
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
    lineHeight: 14,
  },
  right: {
    alignItems: 'flex-end',
    gap: 8,
  },
  chartIcon: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    position: 'absolute',
    bottom: 0,
    right: -4,
  },
  miniBar: {
    width: 6,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  vertLabels: {
    alignItems: 'flex-end',
    gap: 1,
  },
  vertLabel: {
    fontSize: moderateScale(8.5),
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.2,
  },
});

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Colors, Radius, Typography, moderateScale } from '../constants/theme';

interface Props {
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  transactionType: 'BUY' | 'SELL';
  currentPrice?: number | null;
  exitPrice?: number | null;
  exitLeg?: string | null;
  variant?: 'compact' | 'full';
}

export default function SignalPriceBar({
  entryPrice,
  targetPrice,
  stopLossPrice,
  transactionType,
  currentPrice,
  exitPrice,
  exitLeg,
  variant = 'compact',
}: Props) {
  const isBuy = transactionType === 'BUY';
  const isCompleted = exitPrice != null;
  const activePrice = exitPrice ?? currentPrice ?? entryPrice;

  // Compute percentage along the track (0% to 100%)
  // 15% = Stop Loss, 50% = Entry, 85% = Target
  const calculatePercent = (price: number): number => {
    if (isBuy) {
      const sl = stopLossPrice;
      const entry = entryPrice;
      const target = targetPrice;
      const slDist = Math.max(0.1, entry - sl);
      const tgtDist = Math.max(0.1, target - entry);

      if (price <= sl) {
        const belowRatio = (sl - price) / slDist;
        return Math.max(3, 15 - belowRatio * 12);
      }
      if (price <= entry) {
        return 15 + ((price - sl) / slDist) * 35;
      }
      if (price <= target) {
        return 50 + ((price - entry) / tgtDist) * 35;
      }
      const aboveRatio = (price - target) / tgtDist;
      return Math.min(97, 85 + aboveRatio * 12);
    } else {
      // SELL: SL is higher than Entry, Target is lower than Entry
      const sl = stopLossPrice;
      const entry = entryPrice;
      const target = targetPrice;
      const slDist = Math.max(0.1, sl - entry);
      const tgtDist = Math.max(0.1, entry - target);

      if (price >= sl) {
        const aboveRatio = (price - sl) / slDist;
        return Math.max(3, 15 - aboveRatio * 12);
      }
      if (price >= entry) {
        return 15 + ((sl - price) / slDist) * 35;
      }
      if (price >= target) {
        return 50 + ((entry - price) / tgtDist) * 35;
      }
      const belowRatio = (target - price) / tgtDist;
      return Math.min(97, 85 + belowRatio * 12);
    }
  };

  const targetPct = calculatePercent(activePrice);
  const animPercent = useRef(new Animated.Value(targetPct)).current;

  useEffect(() => {
    Animated.spring(animPercent, {
      toValue: targetPct,
      damping: 18,
      stiffness: 160,
      useNativeDriver: false,
    }).start();
  }, [targetPct, animPercent]);

  // Calculate profit or loss
  const diff = isBuy ? activePrice - entryPrice : entryPrice - activePrice;
  const isProfitable = diff >= 0;
  const diffPct = entryPrice > 0 ? (diff / entryPrice) * 100 : 0;
  const hasLivePrice = currentPrice != null && currentPrice > 0;

  const isFull = variant === 'full';

  return (
    <View style={[styles.container, isFull && styles.containerFull]}>
      {/* Top pointer pin */}
      <View style={styles.pointerTrack}>
        <Animated.View
          style={[
            styles.pointerWrap,
            {
              left: animPercent.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        >
          <View style={[styles.pinBubble, isProfitable ? styles.pinBubbleGreen : styles.pinBubbleRed]}>
            <Text style={styles.pinText}>
              {isCompleted ? (exitLeg === 'TARGET_LEG' ? '🎯 Target' : '🛑 SL') : hasLivePrice ? 'LTP' : 'Entry'} ₹{activePrice.toFixed(1)}
            </Text>
            {hasLivePrice && !isCompleted && diff !== 0 && (
              <Text style={styles.pinSubText}>
                {isProfitable ? '+' : ''}{diff.toFixed(1)} ({diffPct.toFixed(1)}%)
              </Text>
            )}
          </View>
          <View style={[styles.pinArrow, isProfitable ? styles.pinArrowGreen : styles.pinArrowRed]} />
        </Animated.View>
      </View>

      {/* The Visual Bar Track */}
      <View style={styles.trackContainer}>
        {/* Left half: Red risk zone */}
        <View style={styles.riskZone} />
        {/* Right half: Green reward zone */}
        <View style={styles.rewardZone} />

        {/* Checkpoint notches */}
        <View style={[styles.checkpointMark, { left: '15%' }]} />
        <View style={[styles.checkpointMark, styles.checkpointMarkEntry, { left: '50%' }]} />
        <View style={[styles.checkpointMark, { left: '85%' }]} />
      </View>

      {/* Checkpoints labels */}
      <View style={styles.labelsRow}>
        <View style={styles.labelColLeft}>
          <Text style={styles.checkpointLabel}>🛑 SL</Text>
          <Text style={[styles.checkpointValue, { color: Colors.error }]}>₹{stopLossPrice}</Text>
        </View>

        <View style={styles.labelColCenter}>
          <Text style={styles.checkpointLabel}>⚡ Entry</Text>
          <Text style={[styles.checkpointValue, { color: Colors.text }]}>₹{entryPrice}</Text>
        </View>

        <View style={styles.labelColRight}>
          <Text style={styles.checkpointLabel}>🎯 Target</Text>
          <Text style={[styles.checkpointValue, { color: Colors.success }]}>₹{targetPrice}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F9FAFB',
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    marginVertical: 4,
  },
  containerFull: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  pointerTrack: {
    height: 28,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  pointerWrap: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
    transform: [{ translateX: -40 }],
    width: 80,
  },
  pinBubble: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBubbleGreen: {
    backgroundColor: Colors.success,
  },
  pinBubbleRed: {
    backgroundColor: Colors.error,
  },
  pinText: {
    fontSize: moderateScale(10),
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pinSubText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F0FDF4',
  },
  pinArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    alignSelf: 'center',
  },
  pinArrowGreen: {
    borderTopColor: Colors.success,
  },
  pinArrowRed: {
    borderTopColor: Colors.error,
  },
  trackContainer: {
    height: 8,
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 4,
    backgroundColor: '#E5E7EB',
  },
  riskZone: {
    flex: 1,
    backgroundColor: '#FCA5A5',
  },
  rewardZone: {
    flex: 1,
    backgroundColor: '#86EFAC',
  },
  checkpointMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#374151',
    transform: [{ translateX: -1 }],
  },
  checkpointMarkEntry: {
    width: 3,
    backgroundColor: '#1E40AF',
    transform: [{ translateX: -1.5 }],
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  labelColLeft: {
    alignItems: 'flex-start',
    width: '30%',
  },
  labelColCenter: {
    alignItems: 'center',
    width: '40%',
  },
  labelColRight: {
    alignItems: 'flex-end',
    width: '30%',
  },
  checkpointLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  checkpointValue: {
    fontSize: moderateScale(11),
    fontWeight: '800',
  },
});

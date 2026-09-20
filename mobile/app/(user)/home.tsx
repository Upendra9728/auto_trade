import React from 'react';
import {
  View, ScrollView, StyleSheet, RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Spacing } from '../../constants/theme';
import HomeHeader from '../../components/home/HomeHeader';
import DhanStatusCard from '../../components/home/DhanStatusCard';
import MarketStatusCard from '../../components/home/MarketStatusCard';
import MarketIndices from '../../components/home/MarketIndices';
import DisciplinedBanner from '../../components/home/DisciplinedBanner';
import HomeTabsSection from '../../components/home/HomeTabsSection';

export default function HomeScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    // Bump key to re-mount market indices (triggering fresh fetch)
    setRefreshKey(k => k + 1);
    await new Promise(res => setTimeout(res, 800));
    setRefreshing(false);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* ── Sticky Header ── */}
      <HomeHeader
        onNotificationPress={() => {/* could navigate to notifications */}}
        onProfilePress={() => router.push('/(user)/profile')}
      />

      {/* ── Scrollable Body ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
      >
        {/* ── Status Row: Dhan + Market ── */}
        <View style={styles.statusRow}>
          <DhanStatusCard />
          <MarketStatusCard />
        </View>

        {/* ── Market Indices ── */}
        <MarketIndices key={`indices-${refreshKey}`} isFocused={!refreshing} />

        {/* ── Disciplined Banner ── */}
        <DisciplinedBanner />

        {/* ── Tabs Section ── */}
        <HomeTabsSection key={`tabs-${refreshKey}`} />

        {/* Bottom breathing room */}
        <View style={{ height: Spacing.lg }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
});

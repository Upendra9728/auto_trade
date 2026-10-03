import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, Typography } from '../constants/theme';
import { getISTDateKey } from '../utils/time';
import type { DayBucket, Paginated, PaginationMeta } from '../types';

type DayState<T> = {
  items: T[];
  meta: PaginationMeta | null;
  loading: boolean;
  loaded: boolean;
};

type DaySection<T> = {
  date: string;
  count: number;
  expanded: boolean;
  loading: boolean;
  items: T[];
  meta: PaginationMeta | null;
  isToday: boolean;
};

interface Props<T> {
  fetchDays: (params: { page?: number; pageSize?: number }) => Promise<Paginated<DayBucket>>;
  fetchItemsForDay: (params: { date: string; page?: number; pageSize?: number }) => Promise<Paginated<T>>;
  renderItem: ({ item }: { item: T }) => React.ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  ListEmptyComponent?: React.ReactElement | null;
  ListHeaderComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  onVisibleItemsChange?: (items: T[]) => void;
  refreshNonce?: number;
  dayPageSize?: number;
  itemPageSize?: number;
  itemTypeLabel?: string;
}

const DEFAULT_DAY_PAGE_SIZE = 15;
const DEFAULT_ITEM_PAGE_SIZE = 20;

function formatDayTitle(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDaySubtitle(dateKey: string, isToday: boolean): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'long' });
  if (isToday) {
    const formatted = d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    return `${weekday} · ${formatted}`;
  }
  return weekday;
}

function formatCount(count: number, label: string = 'item'): string {
  const plural = count === 1 ? label : `${label}s`;
  return `${count} ${plural}`;
}

export default function DayGroupedList<T>({
  fetchDays,
  fetchItemsForDay,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  ListHeaderComponent,
  ListFooterComponent,
  onVisibleItemsChange,
  refreshNonce,
  dayPageSize = DEFAULT_DAY_PAGE_SIZE,
  itemPageSize = DEFAULT_ITEM_PAGE_SIZE,
  itemTypeLabel = 'item',
}: Props<T>) {
  const today = useMemo(() => getISTDateKey(), []);
  const [days, setDays] = useState<DayBucket[]>([]);
  const [daysMeta, setDaysMeta] = useState<PaginationMeta | null>(null);
  const [dayState, setDayState] = useState<Record<string, DayState<T>>>({
    [today]: { items: [], meta: null, loading: false, loaded: false },
  });
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set([today]));
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMoreDays, setLoadingMoreDays] = useState(false);
  const mountedRef = useRef(false);

  // Callers (screens) often pass inline arrow functions that get a new identity on every
  // render; keep the latest version in a ref so the callbacks below don't need them as
  // dependencies — otherwise every parent re-render would reset/reload this whole list.
  const fetchDaysRef = useRef(fetchDays);
  fetchDaysRef.current = fetchDays;
  const fetchItemsForDayRef = useRef(fetchItemsForDay);
  fetchItemsForDayRef.current = fetchItemsForDay;
  const onVisibleItemsChangeRef = useRef(onVisibleItemsChange);
  onVisibleItemsChangeRef.current = onVisibleItemsChange;

  const loadDayItems = useCallback(async (date: string, page: number, append: boolean) => {
    setDayState((prev) => ({
      ...prev,
      [date]: {
        items: prev[date]?.items ?? [],
        meta: prev[date]?.meta ?? null,
        loading: true,
        loaded: prev[date]?.loaded ?? false,
      },
    }));

    try {
      const data = await fetchItemsForDayRef.current({ date, page, pageSize: itemPageSize });
      setDayState((prev) => {
        const current = prev[date];
        const nextItems = append && current?.loaded ? [...(current.items ?? []), ...data.items] : data.items;
        return {
          ...prev,
          [date]: {
            items: nextItems,
            meta: data.meta,
            loading: false,
            loaded: true,
          },
        };
      });
    } catch {
      setDayState((prev) => ({
        ...prev,
        [date]: {
          items: prev[date]?.items ?? [],
          meta: prev[date]?.meta ?? null,
          loading: false,
          loaded: true,
        },
      }));
    }
  }, [itemPageSize]);

  const loadDays = useCallback(async (page: number, replace: boolean) => {
    if (page > 1) setLoadingMoreDays(true);
    try {
      const data = await fetchDaysRef.current({ page, pageSize: dayPageSize });
      setDaysMeta(data.meta);
      setDays((prev) => (replace ? data.items : [...prev, ...data.items.filter((bucket) => !prev.some((day) => day.date === bucket.date))]));
    } catch {
      if (replace) {
        setDays([]);
        setDaysMeta(null);
      }
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
      setLoadingMoreDays(false);
    }
  }, [dayPageSize]);

  const hardRefresh = useCallback(async () => {
    setRefreshing(true);
    setExpandedDates(new Set([today]));
    setDayState({ [today]: { items: [], meta: null, loading: false, loaded: false } });
    setDays([]);
    setDaysMeta(null);
    setInitialLoading(true);
    await loadDays(1, true);
  }, [loadDays, today]);

  const softRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDays(1, true);
    const visibleDates = Array.from(expandedDates);
    if (visibleDates.length > 0) {
      await Promise.all(visibleDates.map((date) => loadDayItems(date, 1, false)));
    }
  }, [expandedDates, loadDayItems, loadDays]);
  const softRefreshRef = useRef(softRefresh);
  softRefreshRef.current = softRefresh;

  useEffect(() => {
    void hardRefresh().finally(() => {
      mountedRef.current = true;
    });
  }, [hardRefresh]);

  useEffect(() => {
    if (!mountedRef.current) return;
    void softRefreshRef.current();
  }, [refreshNonce]);

  useEffect(() => {
    if (!initialLoading && expandedDates.has(today)) {
      const current = dayState[today];
      if (!current?.loaded && !current?.loading) {
        void loadDayItems(today, 1, false);
      }
    }
  }, [dayState, expandedDates, initialLoading, loadDayItems, today]);

  const toggleDay = useCallback((date: string) => {
    const shouldExpand = !expandedDates.has(date);
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (shouldExpand) next.add(date);
      else if (date !== today) next.delete(date);
      return next;
    });

    if (shouldExpand) {
      const current = dayState[date];
      if (!current?.loaded && !current?.loading) {
        void loadDayItems(date, 1, false);
      }
    }
  }, [dayState, expandedDates, loadDayItems, today]);

  const loadMoreForDay = useCallback((date: string) => {
    const current = dayState[date];
    if (!current?.meta) return;
    if (current.loading || current.meta.page >= current.meta.total_pages) return;
    void loadDayItems(date, current.meta.page + 1, true);
  }, [dayState, loadDayItems]);

  const loadMoreDays = useCallback(() => {
    if (!daysMeta || loadingMoreDays || daysMeta.page >= daysMeta.total_pages) return;
    void loadDays(daysMeta.page + 1, false);
  }, [daysMeta, loadDays, loadingMoreDays]);

  const sections = useMemo<DaySection<T>[]>(() => {
    const bucketMap = new Map(days.map((bucket) => [bucket.date, bucket]));
    const orderedDates = [today, ...days.filter((bucket) => bucket.date !== today).map((bucket) => bucket.date)];

    return orderedDates.map((date) => {
      const current = dayState[date];
      const bucket = bucketMap.get(date);
      return {
        date,
        count: bucket?.count ?? current?.items.length ?? 0,
        expanded: expandedDates.has(date),
        loading: !!current?.loading,
        items: current?.items ?? [],
        meta: current?.meta ?? null,
        isToday: date === today,
      };
    });
  }, [days, dayState, expandedDates, today]);

  useEffect(() => {
    if (!onVisibleItemsChangeRef.current) return;
    onVisibleItemsChangeRef.current(sections.flatMap((section) => (section.expanded ? section.items : [])));
  }, [sections]);

  const isAllEmpty =
    !initialLoading &&
    days.length === 0 &&
    (dayState[today]?.loaded ?? false) &&
    (dayState[today]?.items.length ?? 0) === 0;

  if (initialLoading && days.length === 0 && (dayState[today]?.items.length ?? 0) === 0) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={isAllEmpty ? [] : sections}
      keyExtractor={(section) => `day-${section.date}`}
      renderItem={({ item: section }) => {
        const isExpanded = section.expanded;
        return (
          <View style={styles.dayCard}>
            <TouchableOpacity
              style={[
                styles.dayHeader,
                isExpanded && styles.dayHeaderExpanded,
                section.isToday && styles.dayHeaderToday,
              ]}
              onPress={() => toggleDay(section.date)}
              activeOpacity={0.75}
            >
              <View style={styles.dayHeaderLeft}>
                <View style={[styles.badgeIcon, section.isToday && styles.badgeIconToday]}>
                  <Feather
                    name="calendar"
                    size={14}
                    color={section.isToday ? Colors.primary : Colors.textSecondary}
                  />
                </View>
                <View style={styles.titleCol}>
                  <View style={styles.titleRow}>
                    <Text style={styles.dayTitle}>
                      {section.isToday ? 'Today' : formatDayTitle(section.date)}
                    </Text>
                    {section.isToday && (
                      <View style={styles.todayTag}>
                        <Text style={styles.todayTagText}>Active</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.daySubtitle}>
                    {formatDaySubtitle(section.date, section.isToday)}
                  </Text>
                </View>
              </View>

              <View style={styles.dayHeaderRight}>
                <View style={[styles.countBadge, isExpanded && styles.countBadgeExpanded]}>
                  <Text style={[styles.countText, isExpanded && styles.countTextExpanded]}>
                    {formatCount(section.count, itemTypeLabel)}
                  </Text>
                </View>
                <View style={[styles.chevronWrap, isExpanded && styles.chevronWrapExpanded]}>
                  <Feather
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={isExpanded ? Colors.primary : Colors.textMuted}
                  />
                </View>
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.dayContent}>
                {section.loading && section.items.length === 0 ? (
                  <View style={styles.sectionLoading}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={styles.sectionLoadingText}>Loading {itemTypeLabel}s...</Text>
                  </View>
                ) : section.items.length === 0 ? (
                  <View style={styles.sectionEmpty}>
                    <Feather name="inbox" size={20} color={Colors.textMuted} />
                    <Text style={styles.emptyText}>No {itemTypeLabel}s for this day</Text>
                  </View>
                ) : (
                  <View style={styles.itemsWrapper}>
                    {section.items.map((item, index) => (
                      <View key={keyExtractor(item, index)} style={styles.itemContainer}>
                        {renderItem({ item })}
                      </View>
                    ))}
                  </View>
                )}

                {section.loading && section.items.length > 0 && (
                  <View style={styles.sectionLoadingMore}>
                    <ActivityIndicator size="small" color={Colors.primary} />
                  </View>
                )}

                {section.meta && section.meta.page < section.meta.total_pages && !section.loading && (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={() => loadMoreForDay(section.date)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.loadMoreText}>Load more {itemTypeLabel}s</Text>
                    <Feather name="chevron-down" size={13} color={Colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        );
      }}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={
        <View>
          {daysMeta && daysMeta.page < daysMeta.total_pages && (
            <TouchableOpacity style={styles.loadMoreDaysBtn} onPress={loadMoreDays} activeOpacity={0.75}>
              {loadingMoreDays ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <View style={styles.loadMoreDaysRow}>
                  <Feather name="calendar" size={13} color={Colors.primary} />
                  <Text style={styles.loadMoreDaysText}>Load older days</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {ListFooterComponent}
        </View>
      }
      ListEmptyComponent={ListEmptyComponent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={hardRefresh} colors={[Colors.primary]} />}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    ...Shadow.card,
  },
  dayHeader: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayHeaderToday: {
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  dayHeaderExpanded: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#FAFAFB',
  },
  dayHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  dayHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayTitle: {
    ...Typography.body,
    fontWeight: '800',
    color: Colors.text,
  },
  todayTag: {
    backgroundColor: Colors.primaryBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.full,
    marginLeft: 6,
  },
  todayTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
  },
  daySubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  badgeIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIconToday: {
    backgroundColor: Colors.primaryBg,
  },
  countBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  countBadgeExpanded: {
    backgroundColor: Colors.primaryBg,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  countTextExpanded: {
    color: Colors.primary,
  },
  chevronWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  chevronWrapExpanded: {
    backgroundColor: Colors.primaryBg,
  },
  dayContent: {
    padding: Spacing.sm,
    backgroundColor: '#F9FAFB',
    gap: Spacing.sm,
  },
  itemsWrapper: {
    gap: Spacing.sm,
  },
  itemContainer: {
    // Nested cleanly inside the day content
  },
  sectionLoading: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sectionLoadingText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  sectionLoadingMore: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  sectionEmpty: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  loadMoreBtn: {
    marginTop: Spacing.xs,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadMoreText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 11,
  },
  loadMoreDaysBtn: {
    alignSelf: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  loadMoreDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loadMoreDaysText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
});
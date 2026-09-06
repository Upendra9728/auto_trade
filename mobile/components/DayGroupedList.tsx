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

type Row<T> =
  | { type: 'header'; date: string }
  | { type: 'item'; date: string; item: T; index: number }
  | { type: 'loading'; date: string }
  | { type: 'empty'; date: string }
  | { type: 'day-load-more'; date: string }
  | { type: 'days-load-more' };

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
}

const DEFAULT_DAY_PAGE_SIZE = 15;
const DEFAULT_ITEM_PAGE_SIZE = 20;

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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

  const rows = useMemo<Row<T>[]>(() => {
    const nextRows: Row<T>[] = [];

    for (const section of sections) {
      nextRows.push({ type: 'header', date: section.date });
      if (!section.expanded) continue;
      section.items.forEach((item, index) => {
        nextRows.push({ type: 'item', date: section.date, item, index });
      });
      if (section.loading) {
        nextRows.push({ type: 'loading', date: section.date });
      } else if (!section.items.length) {
        nextRows.push({ type: 'empty', date: section.date });
      } else if (section.meta && section.meta.page < section.meta.total_pages) {
        nextRows.push({ type: 'day-load-more', date: section.date });
      }
    }

    if (daysMeta && daysMeta.page < daysMeta.total_pages) {
      nextRows.push({ type: 'days-load-more' });
    }

    return nextRows;
  }, [daysMeta, sections]);

  const isListEmpty = initialLoading && days.length === 0 && (dayState[today]?.items.length ?? 0) === 0;

  if (isListEmpty) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(row, index) => {
        if (row.type === 'header') return `header-${row.date}`;
        if (row.type === 'item') return `item-${row.date}-${keyExtractor(row.item, row.index)}`;
        if (row.type === 'day-load-more') return `day-load-more-${row.date}`;
        return `days-load-more-${index}`;
      }}
      renderItem={({ item: row }) => {
        if (row.type === 'header') {
          const section = sections.find((entry) => entry.date === row.date);
          if (!section) return null;
          return (
            <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleDay(section.date)} activeOpacity={0.8}>
              <View style={styles.sectionHeaderLeft}>
                <View style={styles.badgeIcon}>
                  <Feather name="calendar" size={14} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{section.isToday ? 'Today' : formatDayLabel(section.date)}</Text>
                  <Text style={styles.sectionSubtitle}>{section.count} item{section.count === 1 ? '' : 's'}</Text>
                </View>
              </View>
              <Feather name={section.expanded ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          );
        }

        if (row.type === 'item') {
          const section = sections.find((entry) => entry.date === row.date);
          if (!section || !section.expanded) return null;
          return <View style={styles.itemWrap}>{renderItem({ item: row.item })}</View>;
        }

        if (row.type === 'loading') {
          return (
            <View style={styles.sectionFooter}>
              <ActivityIndicator size="small" color={Colors.primary} />
            </View>
          );
        }

        if (row.type === 'empty') {
          return (
            <View style={styles.sectionFooter}>
              <Text style={styles.emptyText}>No items for this day.</Text>
            </View>
          );
        }

        if (row.type === 'day-load-more') {
          return (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={() => loadMoreForDay(row.date)} activeOpacity={0.75}>
              <Text style={styles.loadMoreText}>Load more</Text>
              <Feather name="chevron-down" size={14} color={Colors.primary} />
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity style={styles.loadMoreDaysBtn} onPress={loadMoreDays} activeOpacity={0.75}>
            {loadingMoreDays ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={styles.loadMoreDaysText}>Load more days</Text>}
          </TouchableOpacity>
        );
      }}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
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
    gap: Spacing.md,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Shadow.card,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  badgeIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...Typography.body,
    fontWeight: '800',
    color: Colors.text,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  itemWrap: {
    marginTop: Spacing.sm,
  },
  sectionFooter: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  loadMoreBtn: {
    marginTop: Spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryBg,
  },
  loadMoreText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  loadMoreDaysBtn: {
    alignSelf: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  loadMoreDaysText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
});
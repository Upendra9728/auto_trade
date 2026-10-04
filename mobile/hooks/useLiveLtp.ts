import { useEffect, useRef, useState, useCallback } from 'react';
import { marketApi } from '../services/api';

interface InstrumentKey {
  segment: string;
  security_id: string;
}

export function useLiveLtp(instruments: InstrumentKey[], enabled: boolean = true, pollIntervalMs = 3500) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const inFlightRef = useRef(false);

  const fetchPrices = useCallback(async () => {
    if (!enabled || instruments.length === 0 || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await marketApi.getLtp(instruments);
      if (res?.prices) {
        setPrices((prev) => ({ ...prev, ...res.prices }));
      }
    } catch {
      // Keep existing cached prices
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, instruments]);

  useEffect(() => {
    if (!enabled || instruments.length === 0) return;
    void fetchPrices();

    const timer = setInterval(() => {
      void fetchPrices();
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [fetchPrices, enabled, pollIntervalMs, instruments.length]);

  const getLtp = useCallback(
    (segment: string, securityId: string): number | undefined => {
      return prices[`${segment}:${securityId}`] ?? prices[`${segment.toUpperCase()}:${securityId}`];
    },
    [prices]
  );

  return { prices, getLtp };
}

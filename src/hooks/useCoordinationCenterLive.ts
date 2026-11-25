import { useCallback, useEffect, useState } from 'react';
import type { CoordinationCenterState } from '../types/coordinationCenter';

export function useCoordinationCenterLive(isActive = true) {
  const [state, setState] = useState<CoordinationCenterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);

  const refreshState = useCallback(async (forceHealth = false) => {
    try {
      const res = await fetch(`/api/coordination/state${forceHealth ? '?force=1' : ''}`);
      if (!res.ok) return null;
      const data = (await res.json()) as CoordinationCenterState;
      setState(data);
      return data;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState(false);
  }, [refreshState]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/coordination/events');
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.addEventListener('state:sync', (ev) => {
      try {
        const next = JSON.parse((ev as MessageEvent).data) as CoordinationCenterState;
        setState(next);
        setLoading(false);
      } catch {
        // ignore malformed payload
      }
    });
    return () => {
      es.close();
      setSseConnected(false);
    };
  }, []);

  useEffect(() => {
    if (isActive && !sseConnected) {
      void refreshState(false);
    }
  }, [isActive, sseConnected, refreshState]);

  return {
    state,
    setState,
    loading,
    sseConnected,
    refreshState,
  };
}

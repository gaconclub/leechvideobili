import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CommandCenterState,
  CommandTask,
  ConversationMessage,
  MuseAgentConfig,
  PerformanceAlert,
  ProductionRun,
} from '../types/commandCenter';

export async function commandCenterApiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Phản hồi không hợp lệ (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Yêu cầu thất bại (HTTP ${res.status})`);
  }
  return data as T;
}

export function useCommandCenterLive(isActive: boolean) {
  const [state, setState] = useState<CommandCenterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sseConnected, setSseConnected] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshState = useCallback(async (forceHealth = false): Promise<CommandCenterState | null> => {
    try {
      const data = await commandCenterApiJson<CommandCenterState>(
        `/api/command-center/state${forceHealth ? '?force=1' : ''}`
      );
      if (!isMountedRef.current) return null;
      setState(data);
      setError('');
      return data;
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err?.message || 'Không thể tải trạng thái Phòng Điều Hành.');
      }
      return null;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial load & active-tab focus sync
  useEffect(() => {
    void refreshState(true);
  }, [refreshState]);

  useEffect(() => {
    if (isActive) {
      void refreshState(false);
    }
  }, [isActive, refreshState]);

  // Real-time SSE connection with immediate event merging + reconnect recovery
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;

    const es = new EventSource('/api/command-center/events');

    const safeParse = <T,>(raw: string): T | null => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    };

    es.onopen = () => {
      if (isMountedRef.current) setSseConnected(true);
    };

    es.onerror = () => {
      if (isMountedRef.current) setSseConnected(false);
    };

    es.addEventListener('state:sync', (ev) => {
      const next = safeParse<CommandCenterState>((ev as MessageEvent).data);
      if (next && isMountedRef.current) {
        setState(next);
        setLoading(false);
        setError('');
      }
    });

    es.addEventListener('run:updated', (ev) => {
      const run = safeParse<ProductionRun>((ev as MessageEvent).data);
      if (!run || !isMountedRef.current) return;
      setState((prev) => {
        if (!prev) return prev;
        const exists = prev.runs.some((r) => r.id === run.id);
        const runs = exists
          ? prev.runs.map((r) => (r.id === run.id ? run : r))
          : [run, ...prev.runs];
        const activeRun =
          prev.activeRun?.id === run.id || prev.selectedRunId === run.id ? run : prev.activeRun;
        return { ...prev, runs, activeRun };
      });
    });

    es.addEventListener('task:updated', (ev) => {
      const task = safeParse<CommandTask>((ev as MessageEvent).data);
      if (!task || !isMountedRef.current) return;
      setState((prev) => {
        if (!prev) return prev;
        const exists = prev.tasks.some((t) => t.id === task.id);
        const tasks = exists
          ? prev.tasks.map((t) => (t.id === task.id ? task : t))
          : [task, ...prev.tasks];
        return { ...prev, tasks };
      });
    });

    es.addEventListener('message:created', (ev) => {
      const msg = safeParse<ConversationMessage>((ev as MessageEvent).data);
      if (!msg || !isMountedRef.current) return;
      setState((prev) => {
        if (!prev) return prev;
        if (prev.conversations.some((m) => m.id === msg.id)) return prev;
        return {
          ...prev,
          conversations: [...prev.conversations, msg].slice(-400),
        };
      });
    });

    es.addEventListener('agent:updated', (ev) => {
      const agent = safeParse<MuseAgentConfig>((ev as MessageEvent).data);
      if (!agent || !isMountedRef.current) return;
      setState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          agents: prev.agents.map((a) => (a.id === agent.id ? agent : a)),
        };
      });
    });

    es.addEventListener('alert:created', (ev) => {
      const alert = safeParse<PerformanceAlert>((ev as MessageEvent).data);
      if (!alert || !isMountedRef.current) return;
      setState((prev) => {
        if (!prev) return prev;
        if (prev.performanceAlerts.some((a) => a.id === alert.id)) return prev;
        return {
          ...prev,
          performanceAlerts: [alert, ...prev.performanceAlerts].slice(0, 60),
        };
      });
    });

    return () => {
      es.close();
      if (isMountedRef.current) setSseConnected(false);
    };
  }, []);

  // Low-frequency fallback sync only if SSE is temporarily disconnected
  useEffect(() => {
    if (sseConnected && !isActive) return;
    const ms = sseConnected ? 15000 : isActive ? 3500 : 12000;
    const timer = setInterval(() => {
      void refreshState(false);
    }, ms);
    return () => clearInterval(timer);
  }, [sseConnected, isActive, refreshState]);

  return {
    state,
    setState,
    loading,
    error,
    setError,
    sseConnected,
    refreshState,
  };
}

"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";

type PolledTask = {
  id: string;
  status: string;
};

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const POLL_INTERVAL_MS = 3_000;
const MAX_CONSECUTIVE_ERRORS = 3;

async function fetchTask(url: string): Promise<PolledTask> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch task: ${response.status}`);
  }

  return (await response.json()) as PolledTask;
}

export default function useTaskPolling(taskId?: string | null) {
  const consecutiveErrorCountRef = useRef(0);

  useEffect(() => {
    consecutiveErrorCountRef.current = 0;
  }, [taskId]);

  const swr = useSWR(taskId ? `/api/tasks/${taskId}` : null, fetchTask, {
    refreshInterval: (task) => {
      if (consecutiveErrorCountRef.current > 0) {
        return 0;
      }

      if (consecutiveErrorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
        return 0;
      }

      if (!task || !task.status) {
        return POLL_INTERVAL_MS;
      }

      return TERMINAL_STATUSES.has(task.status) ? 0 : POLL_INTERVAL_MS;
    },
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: () => {
      if (consecutiveErrorCountRef.current === 0) {
        return;
      }

      consecutiveErrorCountRef.current = 0;
    },
    onError: () => {
      consecutiveErrorCountRef.current = Math.min(
        consecutiveErrorCountRef.current + 1,
        MAX_CONSECUTIVE_ERRORS,
      );
    },
    onErrorRetry: (_error, _key, _config, revalidate) => {
      if (consecutiveErrorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
        return;
      }

      setTimeout(() => {
        void revalidate();
      }, POLL_INTERVAL_MS);
    },
  });

  const mutateTask = swr.mutate;
  const isFinished = Boolean(swr.data && TERMINAL_STATUSES.has(swr.data.status));

  useEffect(() => {
    if (!taskId) {
      return;
    }

    function tryRecoverFromCappedErrors() {
      if (
        consecutiveErrorCountRef.current < MAX_CONSECUTIVE_ERRORS ||
        isFinished
      ) {
        return;
      }

      void mutateTask();
    }

    window.addEventListener("focus", tryRecoverFromCappedErrors);
    window.addEventListener("online", tryRecoverFromCappedErrors);

    return () => {
      window.removeEventListener("focus", tryRecoverFromCappedErrors);
      window.removeEventListener("online", tryRecoverFromCappedErrors);
    };
  }, [isFinished, mutateTask, taskId]);

  return {
    task: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: mutateTask,
    isFinished,
  };
}

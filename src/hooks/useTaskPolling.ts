"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";

type PolledTask = {
  id: string;
  status: string;
};

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const POLL_INTERVAL_MS = 3_000;

async function fetchTask(url: string): Promise<PolledTask> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch task: ${response.status}`);
  }

  return (await response.json()) as PolledTask;
}

export default function useTaskPolling(taskId?: string | null) {
  const isPollingRequestInFlightRef = useRef(false);

  const swr = useSWR(
    taskId ? `/api/tasks/${taskId}` : null,
    async (url: string) => {
      isPollingRequestInFlightRef.current = true;

      try {
        return await fetchTask(url);
      } finally {
        isPollingRequestInFlightRef.current = false;
      }
    },
    {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    },
  );

  const mutateTask = swr.mutate;
  const isFinished = Boolean(swr.data && TERMINAL_STATUSES.has(swr.data.status));

  useEffect(() => {
    if (!taskId || isFinished) {
      return;
    }

    const timerId = window.setInterval(() => {
      if (isPollingRequestInFlightRef.current) {
        return;
      }

      void mutateTask();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
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

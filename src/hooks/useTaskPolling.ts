"use client";

import useSWR from "swr";

type PolledTask = {
  id: string;
  status: string;
};

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

async function fetchTask(url: string): Promise<PolledTask> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch task: ${response.status}`);
  }

  return (await response.json()) as PolledTask;
}

export default function useTaskPolling(taskId?: string | null) {
  const swr = useSWR(taskId ? `/api/tasks/${taskId}` : null, fetchTask, {
    refreshInterval: (task) => {
      if (!task || !task.status) {
        return 3_000;
      }

      return TERMINAL_STATUSES.has(task.status) ? 0 : 3_000;
    },
    revalidateOnFocus: false,
  });

  return {
    task: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
    isFinished: Boolean(swr.data && TERMINAL_STATUSES.has(swr.data.status)),
  };
}

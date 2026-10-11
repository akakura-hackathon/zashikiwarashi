"use client";

import { useEffect, useState } from "react";
import { taskCountdown } from "./emergency-view";

// FN-06: Task offer expiration countdown based on server timestamp.
export function useTaskCountdown(
  expiresAt?: string | null,
  createdAt?: string | null,
): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt && !createdAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, createdAt]);

  return taskCountdown(expiresAt ?? undefined, createdAt ?? undefined, now);
}

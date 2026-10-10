"use client";

import { useEffect, useState } from "react";
import { safetyCountdown } from "./emergency-view";

// FN-01 / FN-08: Both screens use the same server timestamp and wall-clock countdown.
export function useSafetyCountdown(createdAt?: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!createdAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [createdAt]);
  return safetyCountdown(createdAt, now);
}

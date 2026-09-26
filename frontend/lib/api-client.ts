// Backend API client（FN-02）。
// 画面は API Gateway（NEXT_PUBLIC_API_BASE_URL）を呼び、Firebase の ID トークンを Authorization に付ける。
// Gateway がトークンを検証し、未ログインのリクエストは Gateway で拒否される（docs/ARCHITECTURE.md §3.1）。
import type { User } from "firebase/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export type Me = {
  uid: string;
  email: string | null;
  role: "admin" | "resident";
  building_id: string | null;
  resident_id: string | null;
  unit_id: string | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const idToken = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

// API-09
export function getMe(user: User): Promise<Me> {
  return apiFetch<Me>(user, "/me");
}

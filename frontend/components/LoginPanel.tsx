"use client";

// FN-02: Google ログインと、ログインユーザーのロールの確認（API-09 GET /me）。
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { useEffect, useState } from "react";

import { ApiError, getMe, type Me } from "@/lib/api-client";
import { getFirebaseApp } from "@/lib/firebase";

export function LoginPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const auth = getAuth(getFirebaseApp());
    return onAuthStateChanged(auth, async (current) => {
      setUser(current);
      setMe(null);
      setMessage("");
      if (!current) return;
      try {
        setMe(await getMe(current));
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          setMessage("このアカウントは登録されていません。管理人にロールの付与を依頼してください。");
        } else {
          setMessage(`API の呼び出しに失敗しました: ${String(error)}`);
        }
      }
    });
  }, []);

  const login = async () => {
    await signInWithPopup(getAuth(getFirebaseApp()), new GoogleAuthProvider());
  };

  const logout = async () => {
    await signOut(getAuth(getFirebaseApp()));
  };

  if (!user) {
    return (
      <section>
        <p>ログインしてください。</p>
        <button type="button" onClick={login}>
          Google でログイン
        </button>
      </section>
    );
  }

  return (
    <section>
      <p>ログイン中: {user.email}</p>
      {me && (
        <dl>
          <dt>ロール</dt>
          <dd>{me.role === "admin" ? "管理人" : "住民"}</dd>
          <dt>建物</dt>
          <dd>{me.building_id ?? "-"}</dd>
          {me.role === "resident" && (
            <>
              <dt>住民 ID</dt>
              <dd>{me.resident_id}</dd>
            </>
          )}
        </dl>
      )}
      {message && <p role="alert">{message}</p>}
      <button type="button" onClick={logout}>
        ログアウト
      </button>
    </section>
  );
}

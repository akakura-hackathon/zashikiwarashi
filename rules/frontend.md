# Frontend Rules

## 構成
- `app/` — Next.js App Router のルート・ページ・レイアウト。
- `components/` — 再利用可能な UI コンポーネント。ページ固有のロジックは持たせない。
- `lib/` — Firebase クライアント初期化 (`firebase.ts`)、バックエンド API 呼び出し (`api-client.ts`) 等の共有ユーティリティ。

## 環境変数
- `NEXT_PUBLIC_` プレフィックスの変数はビルド時にクライアントへ埋め込まれる（公開情報のみ）。
- バックエンドの秘密情報は `NEXT_PUBLIC_` を付けず、サーバーサイド（Route Handler 等）からのみ参照する。

## 品質ゲート
- `npm run lint` / `npm run typecheck` / `npm run build` を通すこと。
- Firestore/Auth を使うローカル開発では、リポジトリルートで `firebase emulators:start` を起動し、`NEXT_PUBLIC_FIREBASE_EMULATOR=true` で接続する。

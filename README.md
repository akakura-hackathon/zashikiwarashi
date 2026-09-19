# akakura-ai-web-template

AkakuraのAI Agentを活用したWeb開発のテンプレートリポジトリ。ハッカソン等で新規プロジェクトを立ち上げる際の初期構成として使う。

技術スタックは Next.js（frontend） + FastAPI/Google ADK（backend） + Firestore + Terraform（単一GCP環境） + GitHub Actions（WIFデプロイ）。

## 思想

このテンプレートは「**AIエージェントとユーザーが対話しながら実装を進める**」ことを前提に設計している。エージェントがいきなりコードを書き始めるのではなく、次の流れで進むことを想定する。

```
docs/SPEC.md          課題・ユーザー・要件をヒアリングしながら埋める
   ↓
docs/DESIGN.md        API・データモデル・エージェント構成を合意する
   ↓
docs/ARCHITECTURE.md  合意内容をシステム構成として整理する
   ↓
docs/PLAN.md          タスクに分解する
   ↓
実装（backend / frontend / infra）
```

各 `docs/*.md` はスケルトンの状態で、先頭に `> エージェントへ:` というコメントが入っている。エージェントはこれを読み、ユーザーに質問しながら中身を埋めていく。仕様が変わったら実装より先にドキュメントを更新する（ドキュメントとコードを乖離させない）。この流れの詳細は `AGENTS.md` の Workflow セクションを参照。

その他の技術的な方針:

- **モノレポ**: `frontend` と `backend` を1リポジトリで管理する。
- **シングル環境**: dev/stg/prodのような環境分割はしない。GCPプロジェクトは1つ、Terraform stateも1つ。
- **AIエージェントはADKに集約**: `backend/src/agents/agent.py` の `root_agent` を唯一のエントリポイントとし、マルチエージェント化する場合は `sub_agents/` に追加する。
- **デプロイはWIF経由**: サービスアカウントキーを発行せず、GitHub Actions → Workload Identity Federation → Cloud Run / Firebase Hosting でデプロイする。
- **レイヤード構成（backend）**: `routers → services → clients/db`、`agents` は独立レイヤー。責務を混ぜない（詳細は `.agents/rules/backend.md`）。
- **秘密情報はコミットしない**: `.env` 系は `*.env.example` のみコミット。実際の値やサービスアカウントキーは対象外（`.gitignore` 参照）。
- **使い捨てコードは `sandbox/`**: 実験的なコードは `src/` に置かず `sandbox/`（gitignore対象）に置く。

## 使い方

1. このリポジトリをコピー（またはテンプレートとして使用）してプロジェクトを開始する。
2. Claude Code / Antigravity（Gemini CLI）などのAIコーディングエージェントを起動する。どのツールも `AGENTS.md` を読み込む前提（`CLAUDE.md` / `GEMINI.md` は各ツール向けのポインタ。下記「エージェント向け設定ファイル」参照）。
3. エージェントと対話しながら `docs/SPEC.md` → `DESIGN.md` → `ARCHITECTURE.md` → `PLAN.md` を埋める。
4. 合意した設計をもとに `backend/` `frontend/` `infra/` を実装する。各ファイルの `TODO` コメントが実装対象の目印。
5. Getting Started（下記）でローカル起動して動作確認する。

## エージェント向け設定ファイル

| ファイル | 対象ツール | 役割 |
|---|---|---|
| `AGENTS.md` | 共通 | 指示の実体。Workflow・Core Rules・Commands・Code Styleを定義 |
| `CLAUDE.md` | Claude Code | `AGENTS.md` を参照するだけのポインタ |
| `GEMINI.md` | Antigravity / Gemini CLI | `AGENTS.md` を参照するだけのポインタ |
| `.agents/rules/{backend,frontend,infra}.md` | 共通 | 各領域の詳細規約 |

## ディレクトリ構成

```
.
├── AGENTS.md / CLAUDE.md / GEMINI.md  # AIエージェント向け指示（上表参照）
├── docs/                  # 企画・設計ドキュメント（対話で埋めるスケルトン）
│   ├── SPEC.md            # 課題・要件
│   ├── DESIGN.md          # API・データモデル・エージェント設計
│   ├── ARCHITECTURE.md    # システム構成
│   └── PLAN.md            # マイルストーン・タスク分解
├── frontend/               # Next.js (App Router)
│   ├── app/                # ルーティング・ページ
│   ├── components/         # UIコンポーネント
│   └── lib/                 # Firebaseクライアント・APIクライアント
├── backend/                # FastAPI + Google ADK
│   ├── src/
│   │   ├── routers/         # エンドポイント定義
│   │   ├── services/        # ビジネスロジック・ADK Runner呼び出し
│   │   ├── agents/          # ADKエージェント定義（root_agent, sub_agents/）
│   │   ├── clients/         # 外部サービスへの薄いラッパー
│   │   ├── db/               # データアクセス層
│   │   └── models/           # Pydanticスキーマ
│   ├── tests/
│   └── scripts/              # デプロイ等の運用スクリプト
├── infra/terraform/        # GCPリソース定義（シングル環境）
├── .github/workflows/      # CI / WIFデプロイ
└── sandbox/                 # 使い捨てコード（gitignore対象）
```

## Getting Started

```
# backend
cd backend && uv sync && uv run uvicorn src.main:app --reload

# frontend
cd frontend && npm install && npm run dev
```

その他コマンド・品質ゲートは `AGENTS.md` を参照。

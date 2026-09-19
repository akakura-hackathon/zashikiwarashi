# AGENTS.md

## Project Overview
モノレポのハッカソンテンプレート: Next.js フロントエンド + FastAPI/Google ADK バックエンド。
Cloud Run + Firebase Hosting に GitHub Actions (Workload Identity Federation) でデプロイする。
詳細は `docs/ARCHITECTURE.md` を参照。

## Workflow（ドキュメント駆動・対話開発）
このテンプレートは、エージェントがユーザーと対話しながら実装を進めることを前提にしている。コードを書く前に必ずこの順で進める。

1. `docs/SPEC.md` — 課題・想定ユーザー・機能要件・非対象をユーザーに確認しながら埋める。
2. `docs/DESIGN.md` — API・データモデル・エージェント設計をユーザーと合意する。
3. `docs/ARCHITECTURE.md` — 上記を実際のシステム構成に落とす。
4. `docs/PLAN.md` — タスクに分解し、実装を進めながら更新する。
5. 実装は各ドキュメントの合意後に着手する。仕様や設計に不明点・複数の選択肢がある場合は、仮実装せずユーザーに確認する。
6. 実装中に仕様変更が発生したら、先に該当ドキュメントを更新してから実装に反映する（ドキュメントとコードを乖離させない）。

各 `docs/*.md` の先頭にエージェント向けの短い指示コメント（`> エージェントへ:`）がある。

## Core Rules
- 秘密情報・サービスアカウントキー・`.env` ファイルは絶対にコミットしない。
- `backend/.venv`、`frontend/node_modules`、`infra/terraform` の state/plan ファイルはコミットしない。
- 実験的・使い捨てのコードは `sandbox/`（gitignore 対象）に置き、`src/` には置かない。
- バックエンドの変更は `ruff check` と `pytest` を通してからマージする。
- フロントエンドの変更は `lint` / `typecheck` / `build` を通してからマージする。

## Commands
| タスク | コマンド |
|---|---|
| Backend dev | `cd backend && uv run uvicorn src.main:app --reload` |
| Backend test | `cd backend && uv run pytest` |
| Backend lint | `cd backend && uv run ruff check .` |
| Frontend dev | `cd frontend && npm run dev` |
| Frontend build | `cd frontend && npm run build` |
| Emulators | `firebase emulators:start`（リポジトリルートで実行） |
| Terraform check | `cd infra/terraform && terraform validate` |

## Code Style
- Python: ruff（line-length 100, py312 target）。レイヤード構成 `src/{routers,clients,agents,models,services,db}`。
- TypeScript: Next.js App Router 規約。コンポーネントは `frontend/components` に配置。

## Further Reading
- `.agents/rules/backend.md` / `frontend.md` / `infra.md` に各領域の詳細規約がある。
- `CLAUDE.md`（Claude Code）/ `GEMINI.md`（Antigravity, Gemini CLI）は、それぞれのツールが参照する規約に合わせて用意した、このファイルへのポインタ。指示の実体は常にこの `AGENTS.md`。

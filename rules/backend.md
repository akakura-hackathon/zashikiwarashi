# Backend Rules

## レイヤード構成
`backend/src/` は以下の役割で分離する。責務を混ぜない。

- `routers/` — FastAPI のエンドポイント定義のみ。ビジネスロジックは `services/` に委譲する。
- `agents/` — Google ADK エージェント定義。`agent.py` の `root_agent` が唯一のエントリポイント。
- `clients/` — 外部サービス（Firestore, GCS 等）への薄いラッパー。
- `models/` — Pydantic スキーマ。
- `services/` — ビジネスロジック・ADK Runner の呼び出し。
- `db/` — データアクセス層。

## ADK エージェントの拡張
新しいエージェントを追加する場合:
1. マルチエージェント構成にする場合は `agents/sub_agents/` にサブエージェントを追加し、`agent.py` の `root_agent` に `sub_agents=[...]` で接続する。
2. エージェントが使うツール関数は `agents/` 配下か `services/` に置き、`tools=[...]` に渡す。
3. `tests/agents/` にエージェントのインスタンス化・ツール呼び出しの単体テストを追加する（実際の Gemini API 呼び出しはモックする）。

## 品質ゲート
- `uv run ruff check .` と `uv run pytest` を通すこと。
- 新しい依存関係は `pyproject.toml` に追加し、`uv sync` で `uv.lock` を更新する。

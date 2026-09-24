# AGENTS.md

## Project Overview
**Zashikiwarashi**: マンション内の潜在的な助け合いを、緊急時（停電・火災・地震・洪水）だけ安全に利用可能にする Multi-Agent サービス。
住民ごとの Resident Agent と建物全体の Building Agent が、個人情報を出さずに「誰が困っていて、誰なら無理なく助けられるか」を見つけ、本人の承認を得て協力計画を実行する。
Google Cloud Japan AI Hackathon Vol.5 向け（提出 2026-10-15 23:59）。MVP は「動くデモ ＋ 設計済み拡張候補の明示」に絞る。

技術構成: Next.js（frontend）＋ FastAPI / Google ADK（backend）＋ Firestore ＋ Terraform（単一GCP環境）。
Cloud Run + Firebase Hosting に GitHub Actions（Workload Identity Federation）でデプロイする。

## Where to look
| 知りたいこと | 読む場所 |
|---|---|
| 何を解決するか・要件・受け入れ基準・プライバシー要件 | `docs/SPEC.md` |
| データモデル・Agent 構成・承認フロー・デモシナリオ4種・API | `docs/DESIGN.md`（データモデルの正は ER図） |
| GCP 構成・外部連携・停電時のフォールバック | `docs/ARCHITECTURE.md` |
| MVP の範囲（実装する/しない）・スケジュール・タスク | `docs/PLAN.md` §2〜4 |
| 機能（FN-xx）に関係する要件・設計・データ・API | `docs/TRACEABILITY.md` |
| 未解決の指摘・未決事項 | `docs/FUCHIUE_REVIEW.txt`、各図の TBD 欄 |
| レビュー指摘への回答・対策方針 | `docs/FUCHIUE_REVIEW_RESPONSE.txt` |
| 図の一覧と、どの docs に対応するか | `docs/README.md`（図は `docs/diagrams/`） |
| 領域ごとの実装規約 | `rules/backend.md` / `frontend.md` / `infra.md` |

## Domain Principles（実装で必ず守る）
1. **平時の手入力ゼロ**: 住民に日常的な入力・登録を求めない（DESIGN §1）。
2. **人物プロファイリングをしない**: 性格・協力度・嗜好を推定・保存しない。承認/拒否の履歴は監査用で、評価やスコアに変換しない（SPEC §3.2〜3.3）。
3. **段階的開示（Progressive Disclosure）**: Agent 間は抽象化したトークンのみ。部屋番号などは本人が承認した後にだけ開示する（DESIGN §4）。
4. **LLM に権限を与えない**: アクセス権・開示可否・未承認アクションの遮断は、LLM ではなくコード（Policy Engine）で強制する（DESIGN §1）。
5. **Human-in-the-Loop**: 実世界の行動の確定と高識別情報の開示は、必ず本人承認を経る（SPEC §4.1、DESIGN §5.5）。
6. **Agent Isolation / Outbound Gate**: Resident Agent は他住民の Raw Data・Memory に直接触れない。Agent の外向き通信はすべて Privacy Gateway を通す（SPEC §4.1）。

## Workflow（ドキュメント駆動・対話開発）
`docs/` は v1.0 として記述済み。コードを書く前に、関連する docs を読む。

1. 実装の前に `docs/PLAN.md` §2 で、対象が MVP 範囲か（拡張予定はダミーで代替）を確認する。担当機能の FN-xx を `docs/TRACEABILITY.md` で引き、関連する要件・設計だけを読む。
2. 仕様・設計に不明点や複数の選択肢がある場合は、仮実装せずユーザーに確認する。未決事項は `docs/FUCHIUE_REVIEW.txt` と各図の TBD に残っている。
3. 仕様変更が発生したら、先に該当の docs（と対応する図）を更新してから実装に反映する。ドキュメントとコードを乖離させない。
4. データモデル（エンティティ・属性・関係）は ER図を正とする。ER図に無い項目が必要になったら、`docs/DESIGN.md` §7.4 に追記してユーザーに確認する。
5. ブランチ名・コミット・PR・コード内コメントには機能ID（FN-xx）を書く。IDは変えず、廃止したら欠番にする。

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

## Skills（図の作成）
| スキル | 用途 | 呼び出し例 |
|---|---|---|
| `create-diagram` | 汎用（構成図・ER・シーケンス・CI/CD・業務フロー・画面遷移・体制図） | 「CI/CD パイプラインの図を作って」 |
| `create-diagram-d-flow` | 業務フロー特化（As-Is/To-Be、ギャップ分析） | 「この業務フローを To-Be で図にして」 |
| `create-diagram-d-nodeedge` | 構成図・画面遷移・体制図など、ノードとエッジの図 | 「画面遷移図を作って」 |

- 実体は `.agents/skills/`（Antigravity・Copilot が読む）。`.claude/skills/` はそこへのシンボリックリンク（Claude Code・Copilot が読む）。スキルの中身は編集しない。
- スキル既定の出力先（`03_設計・開発/…` など）は使わず、`docs/diagrams/` に保存する。ファイル名は `Zashikiwarashi_<図の名前>_v{MAJOR}.{MINOR}.drawio`。既存ファイルは上書きせず、バージョンを繰り上げる。
- `.drawio` は XML でアイコンが埋め込まれており大きい。図の内容を知りたいときは全文を読まず、`docs/README.md` と対応する docs を見る。編集するときだけ開く。
- 出典: [enomoso-pm/drawio-diagram-skills](https://github.com/enomoso-pm/drawio-diagram-skills)（MIT。ライセンスは `.agents/skills/LICENSE.drawio-diagram-skills`）。更新は出典から取り込み直す。

## Further Reading
- `CLAUDE.md`（Claude Code）/ `GEMINI.md`（Antigravity, Gemini CLI）/ `.github/copilot-instructions.md`（GitHub Copilot）は、それぞれのツール向けの、このファイルへのポインタ。指示の実体は常にこの `AGENTS.md`。

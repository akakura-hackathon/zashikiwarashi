# Zenn記事の編集メモ（本文には含めない）

確認日: 2026-10-12。対象: FN-01〜FN-11。原稿は `docs/zenn-article.md`。

## 投稿方法と参照記事

- Zenn Webエディタでは先頭のYAMLを本文に貼らず、タイトルとトピックを各欄に設定する。カテゴリはIdea。`published: false` は下書き用。
- [公式ページ](https://zenn.dev/hackathons/google-cloud-japan-ai-hackathon-vol5)ではZenn記事は任意、投稿する場合はIdeaを指定。提出プロジェクトには別途、アーキテクチャ図の画像と3分程度のデモ動画が必要。今回の依頼に従い画像は作成していない。
- 過去作品は[フクシア](https://zenn.dev/teritama/articles/aa54b4fbed1231)と[Anatom-AI](https://zenn.dev/jcs300/articles/5511ded660f522)を参照。課題→利用例→技術→制約の構成を参考にし、本文や実績は転用していない。
- 動画URLは提供されていないため埋め込んでいない。公開用URLが決まったら利用シナリオの直前に追加できる。

## 記事の根拠

| 記事の記述 | 主な確認先 |
| --- | --- |
| 課題、利用者、人物評価をしない方針 | `docs/SPEC.md` §1〜4 |
| MVP・外部連携の範囲 | `docs/PLAN.md` §2、`docs/TRACEABILITY.md` |
| 50戸の架空データ | `docs/DESIGN.md` §7.3.4、`backend/src/db/seed.py` |
| 候補選定・出力検証・フォールバック | `backend/src/agents/building_agent.py`、`backend/src/services/triage_service.py` |
| 自由文の構造化・身体制約評価 | `backend/src/agents/resident_agent.py` |
| 承認・開示用フィールドのマスキング | `backend/src/services/policy_engine.py`、`backend/src/services/task_service.py` |
| Model Armorとパターン検査 | `backend/src/agents/governance.py` |
| 文字列の置換 | `backend/src/services/privacy_gateway.py` |
| ADK定義 | `backend/src/agents/adk_agents.py` |
| Studio画面 | `frontend/components/StudioWorkspace.tsx`、`CockpitPanel.tsx`、`PhoneStage.tsx` |
| 通知テスト | `backend/src/routers/push.py`、`frontend/lib/push-notification.ts` |
| インフラとデプロイ | `infra/terraform/`、`.github/workflows/deploy.yml` |
| テストの存在 | `backend/tests/test_policy_engine.py`、`backend/tests/test_sc3_full_scenario.py` |

今回は記事作成のための静的確認。テスト再実行、デプロイ状況の照合、実機E2Eの検証はしていないため、テスト件数・全件成功・本番動作保証は記載していない。

## 既存の提出文から転用しなかった主張

以下は実装変更の提案や承認待ち事項ではなく、記事の断定を避けた根拠。

- **「モックなし」「実データ」**: 在館情報などはデモ用。50戸は実住民の実証ではなくシードデータ。
- **「すべてのAgent間通信が抽象トークンのみ」**: `building_agent.py` のGemini入力、`adk_agents.py` の候補取得結果には `room_number` が含まれる。記事は住民向けタスクAPIの開示用フィールドに記述を限定した。Task自体のID等から識別できないことまで保証していない。
- **「本人承認」**: タスクAPIで確認されるのは担当者の承認。未応答の対象住民が都度承認したという意味にはできない。
- **「2つの独立Agent Runtimeが本番経路で協調」**: `docs/submission.md` に稼働記載はあるが、`backend/scripts/deploy_agents.py` は未実装。安否確認APIのBuildingAgentは直接Geminiを呼ぶため、実際のRuntime呼び出し履歴との照合なしには断定しない。
- **「Model Armorが常に物理遮断」**: API未設定・例外時は検出なしとしてパターン検査へ進む実装。すべての失敗が通信遮断になるという記述は避けた。
- **「Resident Agentが必ず全打診を検査」**: ResidentAgentClientの通信失敗時には `can_execute: true` の戻り値がある。個別の評価処理が存在することと、全経路で安全性が保証されることは区別した。
- **「最適な空間グラフ探索」**: ルールベース実装は同階の部屋番号差で選定しているため、最短経路・最適性を保証する表現にしていない。
- **「救助隊の出動確定」**: `docs/DESIGN.md` 末尾のFN-08補足では派遣記録は未実装。管理人の把握支援までを記述。
- **「防災効果を実証」**: 時間短縮・救助率・利用者評価の測定根拠を確認できないため数値や体験談を作っていない。

既存の `docs/submission.md` や設計書は変更していない。最終提出時に、これらの強い表現と実装の対応を揃えると記事との不一致を避けられる。

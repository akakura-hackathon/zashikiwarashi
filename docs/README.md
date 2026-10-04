# docs 案内

Zashikiwarashi の企画・設計ドキュメントと図の入口。実装の前に、目的に合うものだけを読む。

## 目的別の読み先

| 知りたいこと | 読む場所 |
|---|---|
| 課題・ユーザー・要件・受け入れ基準 | [SPEC.md](SPEC.md) §1〜3、§6 |
| プライバシー・セキュリティ要件 | [SPEC.md](SPEC.md) §4 |
| データカテゴリ・抽象化パイプライン | [DESIGN.md](DESIGN.md) §2〜4 |
| Agent 構成・協議フロー・Human Approval | [DESIGN.md](DESIGN.md) §5 |
| デモシナリオ4種（停電・火災・地震・洪水） | [DESIGN.md](DESIGN.md) §6 |
| データモデル（ER図準拠）・ER未収容の項目 | [DESIGN.md](DESIGN.md) §7、ER図 |
| API 一覧 | [DESIGN.md](DESIGN.md) §8 |
| フロントエンドUI/UX仕様・PWA/Web Push | [DESIGN.md](DESIGN.md) §9、[UI_DESIGN_SPEC.md](UI_DESIGN_SPEC.md)（画面モック詳細仕様正本） |
| GCP 構成・外部連携・停電時のフォールバック | [ARCHITECTURE.md](ARCHITECTURE.md) |
| MVP で実装する範囲・スケジュール・タスク | [PLAN.md](PLAN.md) §2〜4 |
| 機能（FN-xx）から要件・設計・データ・API をたどる | [TRACEABILITY.md](TRACEABILITY.md) |
| 未解決の指摘・未決事項 | [FUCHIUE_REVIEW.txt](FUCHIUE_REVIEW.txt)、各図の TBD 欄 |
| レビュー指摘への回答・対策方針 | [FUCHIUE_REVIEW_RESPONSE.txt](FUCHIUE_REVIEW_RESPONSE.txt) |

## 図（`diagrams/`）

| 図 | 何が分かるか | 対応する docs |
|---|---|---|
| `Zashikiwarashi_structure_architecture_ランタイム構成_v1.3.drawio` | **全体構成図**。緊急時のデータ・制御フロー全体（Client / App / Data / External の層、画面から API への入口の API Gateway、Agent ガバナンスの制御ポイント [G1]〜[G6]、Agent Runtime の Building Agent・Resident Agent、Cloud Run のツールサービス、Cloud Logging・Cloud Trace。リージョンは us-central1） | [ARCHITECTURE.md](ARCHITECTURE.md) §1・§3 |
| `Zashikiwarashi_structure_architecture_Agentガバナンス・オブザーバビリティ_v1.1.drawio` | **Agent ガバナンス・オブザーバビリティ図**。制御ポイント [G1]〜[G8]・観測点 [O1]〜[O5] の詳細と一覧、MVP の区分（無印／余力／図のみ）。村上作成の v1.0 を今回の決定事項で更新 | [ARCHITECTURE.md](ARCHITECTURE.md) §3.4・§3.5 |
| `Zashikiwarashi_ER図_v1.0.drawio` | 論理データモデル（L2）。Cat 1〜5 の13エンティティ（E-001〜E-013, E-016）と関係。**データモデルの正**（図中表記は v1.1） | [DESIGN.md](DESIGN.md) §3・§7 |
| `Zashikiwarashi_緊急時の物資支援フロー(To-Be)_v1.0.drawio` | シナリオ1 停電×EV停止：物資の階段バケツリレー | [DESIGN.md](DESIGN.md) §6.1 |
| `Zashikiwarashi_火災時の避難同行フロー(To-Be)_v1.0.drawio` | シナリオ2 火災：要支援者と避難可能住民のマッチング | [DESIGN.md](DESIGN.md) §6.2 |
| `Zashikiwarashi_地震直後の安否確認分散フロー(To-Be)_v1.0.drawio` | シナリオ3 地震：未応答住戸確認の並列化 | [DESIGN.md](DESIGN.md) §6.3 |
| `Zashikiwarashi_洪水時の垂直避難同行フロー(To-Be)_v1.0.drawio` | シナリオ4 洪水：垂直避難の同行マッチング | [DESIGN.md](DESIGN.md) §6.4 |

- 図の例外処理（再打診・エスカレーション）と、図の右上の TBD は「案・未合意」。実装の根拠にせず、確認してから使う。
- `.drawio` は XML で、GCP アイコンが埋め込まれていて大きい（約30〜50KB）。内容を知りたいときは全文を読まず、この表と対応する docs を見る。編集するときだけ開く。
- 図を作る・更新するときのルールは、リポジトリルートの [AGENTS.md](../AGENTS.md) の「Skills」を参照。
- 図と docs が食い違ったら、先に docs を更新する。ただしデータモデルは ER図を正とし、docs を ER図に合わせる。
- 業務フロー図の DB レーンは ER図準拠に改める前の表現（「Plan / Approval INSERT」など）が残っている。

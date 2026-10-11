# Zashikiwarashi — ID一覧・対応表（トレーサビリティ）

*機能（FN）を起点に、要件・設計・データ・API・図をたどるための表*

実装するときは、この表で担当機能の行を見て、関連する要件と設計だけを読む。仕様を変えたら、先に該当 docs とこの表を更新する。

---

## 1. IDの体系

| 接頭辞 | 対象 | 定義場所 |
| :--- | :--- | :--- |
| REQ-xx | 受け入れ基準（機能要件） | [SPEC.md §6](SPEC.md) |
| PRV-xx | プライバシー原則 | [SPEC.md §4.1](SPEC.md) |
| NFR-xx | 非機能要件 | [SPEC.md §5](SPEC.md) |
| SC-x | デモシナリオ | [SPEC.md §2.3](SPEC.md)、[DESIGN.md §6](DESIGN.md) |
| AG-xx | Agent・ガードレール | [DESIGN.md §5.1](DESIGN.md) |
| E-xxx | データエンティティ（ER図と同一ID） | ER図、[DESIGN.md §7.1](DESIGN.md) |
| API-xx | API | [DESIGN.md §8](DESIGN.md) |
| FN-xx / EXT-xx | 機能（MVP / 拡張） | [PLAN.md §2](PLAN.md) |

- ID は一度振ったら変えない。廃止したら欠番にし、再利用しない。
- 業務フロー図の中のID（U-001、B-001、X-001、D-001、E-001 など）は**図ごとのローカルID**。ER図の E-xxx とは別物なので、docs からは「図名＋ローカルID」で参照する（例: 火災時の避難同行フロー B-007）。
- ブランチ名・コミットメッセージ・PR・コード内コメントでは FN-xx を書く（例: `feat(FN-06): 打診の承認/辞退APIを追加`）。

---

## 2. 機能 → 要件・設計・データ・API

| 機能 | 満たす要件 | 守る原則・非機能 | 設計（DESIGN.md） | 主なエンティティ | API | Agent | シナリオ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| FN-01 管理人コンソール（発令・指示） | REQ-01, REQ-03 | ― | §3.4, §5.2, §5.6 | E-008, E-011 | API-01 | AG-02 | SC-1〜4 |
| FN-02 認証とロール分離 | REQ-02 | PRV-04 | §3.2, §7.3.2（ARCHITECTURE §3.1） | E-002, E-005 | 全 API（ID トークン） | ― | 全シナリオ |
| FN-03 Resident Agent（Context分離・タスク評価・逆提案・開示の最小化・本人との対話） | REQ-04, REQ-15 | PRV-02, PRV-03, PRV-04, NFR-04 | §3.2, §3.3, §5.1, §5.3, §5.8 | E-005〜E-007, E-013 | ― | AG-01 | SC-1〜4 |
| FN-04 Building Agent（援助Taskの計画生成） | REQ-05 | NFR-01, NFR-02, NFR-03, NFR-04 | §3.1, §5.3, §5.4, §6 | E-001〜E-004, E-011, E-012 | API-03, API-08 | AG-02 | SC-1〜4 |
| FN-05 Privacy Gateway | REQ-06, REQ-11 | PRV-02, PRV-05 | §4, §5.1 | ― | ― | AG-03 | SC-1〜4 |
| FN-06 打診とHuman Approval | REQ-07 | PRV-06 | §5.5, §5.7, §9 | E-012, E-013 | API-04, API-10 | AG-02, AG-04 | SC-1〜4 |
| FN-07 Progressive Disclosure の画面遷移 | REQ-07, REQ-11 | PRV-06, PRV-08 | §4, §5.5, §9 | E-002, E-013, E-016 | API-06 | AG-04 | SC-1〜4 |
| FN-08 タスク進捗の報告とダッシュボード | REQ-08, REQ-09 | NFR-03 | §3.4, §5.7, §6.3 D | E-009, E-010, E-012, E-013 | API-02, API-03, API-05, API-08 | ― | SC-1〜4 |
| FN-09 監査ログの事後閲覧 | REQ-10 | PRV-07, NFR-01 | §3.5 | E-016 | API-07 | ― | 全シナリオ |
| FN-10 Agent ガバナンス（G1〜G4・G6） | REQ-13 | PRV-04, PRV-05 | §5.1（ARCHITECTURE §3.4） | ― | ― | AG-05 | SC-1〜4 |
| FN-11 Agent Observability と監査ログ（O1・O2・G7） | REQ-14 | PRV-03, PRV-07, NFR-01 | ARCHITECTURE §3.5 | ― | ― | AG-01, AG-02 | SC-1〜4 |
| EXT-01 Google Calendar 実連携 | ― | PRV-01 | §3.3.1 | E-007 | ― | ― | SC-1, SC-3 |
| EXT-02 端末在宅シグナル | ― | PRV-01 | §3.3.2 | E-007 | ― | ― | SC-1 |
| EXT-03 電力スマートメーター実連携 | ― | PRV-01 | ARCHITECTURE §2.3 | E-007 | ― | ― | SC-1 |
| EXT-04 インターホン盤連携 | ― | PRV-01 | ARCHITECTURE §2.4 | E-007 | ― | ― | ― |
| EXT-05 Cloud KMS / VPC SC | ― | ― | SPEC §4.4 | ― | ― | ― | ― |
| EXT-06 Resident Agent 同士の直接調整 | ― | PRV-04, PRV-05 | §5.8 | ― | ― | AG-01, AG-05 | SC-1 |
| EXT-07 評価ゲート・アラート・ext_authz | ― | NFR-03 | ARCHITECTURE §3.4.3（G5・G8・O4） | ― | ― | AG-04, AG-05 | SC-1〜4 |
| EXT-08 BigQuery Agent Analytics・Online Monitors | ― | PRV-03 | ARCHITECTURE §3.4.3（O3・O5） | ― | ― | ― | ― |
| EXT-09 音声入力（C7）・画面読み上げ（C1） | ― | ― | UI_DESIGN_SPEC.md §1, §3 | ― | ― | ― | ― |

- REQ-12（嗜好・人格プロフィールを生成しない）は全機能の制約。特定の機能には割り当てない。
- NFR-05（デモの再現性優先）は全機能の制約。

---

## 3. 要件 → 機能（逆引き）

| 要件 | 機能 |
| :--- | :--- |
| REQ-01 管理人が全館を緊急モードにできる | FN-01 |
| REQ-02 住戸に紐付いた認証済みユーザーとして操作できる | FN-02 |
| REQ-03 管理人が自然言語で目的・避難方針を指示できる | FN-01 |
| REQ-04 3名以上のResident Agentがタスクを評価し、逆提案を含めて協議できる | FN-03, FN-04 |
| REQ-05 1対1に限定されない協力計画を生成できる | FN-04 |
| REQ-06 外向きAgentメッセージがPrivacy Gatewayを通る | FN-05 |
| REQ-07 本人未承認の実世界アクションがCommitされない | FN-06, FN-07 |
| REQ-08 タスクの開始・完了・失敗を報告できる | FN-08 |
| REQ-09 管理人が安否・進行状況を確認できる | FN-08 |
| REQ-10 住民が後から利用・開示・承認の履歴を確認できる | FN-09 |
| REQ-11 最大公開ラインを超える個人情報が表示されない | FN-05, FN-07 |
| REQ-12 嗜好・人格プロフィールを生成しない | 全機能の制約 |
| REQ-13 Agent への入力・Agent 間通信が Agent Gateway を通り、検査と権限制御を受ける | FN-10 |
| REQ-14 Agent の動作を Cloud Trace で追跡できる | FN-11 |
| REQ-15 住民の自由文を Resident Agent が聞き返しつつ構造化する | FN-03 |

---

## 4. シナリオ → 図・設計

| シナリオ | 設計 | 業務フロー図（`diagrams/`） |
| :--- | :--- | :--- |
| SC-1 停電 × EV停止（物資の階段リレー） | DESIGN.md §6.1 | `Zashikiwarashi_緊急時の物資支援フロー(To-Be)_v1.0.drawio` |
| SC-2 火災 × 避難同行 | DESIGN.md §6.2 | `Zashikiwarashi_火災時の避難同行フロー(To-Be)_v1.0.drawio` |
| SC-3 地震直後 × 安否確認分散（基幹デモ） | DESIGN.md §6.3 | `Zashikiwarashi_地震直後の安否確認分散フロー(To-Be)_v1.0.drawio` |
| SC-4 洪水 × 垂直避難 | DESIGN.md §6.4 | `Zashikiwarashi_洪水時の垂直避難同行フロー(To-Be)_v1.0.drawio` |

> 業務フロー図の DB レーン（「Plan / Approval INSERT」など）と「Lifestyle Memory」の記述は、ER図準拠に改める前の表現のまま。図の更新は未対応。

---

## 相互参照

- **課題・ユーザー・要件** → [SPEC.md](SPEC.md)
- **データモデル・エージェント設計** → [DESIGN.md](DESIGN.md)
- **システム構成** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **タスク分解・マイルストーン** → [PLAN.md](PLAN.md)

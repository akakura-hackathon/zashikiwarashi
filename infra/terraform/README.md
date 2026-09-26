# Infra (Terraform)

GCP プロジェクト `zashikiwarashi`（単一環境・us-central1）のリソースを管理する。方針は `rules/infra.md`、全体の流れは `docs/ARCHITECTURE.md` §6。

- state は GCS バケット `zashikiwarashi-tfstate` に置く（`provider.tf` の backend）。
- 通常は GitHub Actions が実行する。PR で `ci.yml` が plan、main へのマージで `deploy.yml` が apply する。
- ローカルからの apply は、初回構築と障害対応のときだけにする。

## 初回構築（1回だけ・オーナー権限で実行）

GitHub Actions が GCP に認証するための土台（Workload Identity Federation とサービスアカウント）は、Actions が動く前に作る必要がある。

```sh
gcloud auth login
gcloud auth application-default login
# ADC のクォータ用プロジェクトが別プロジェクトだと serviceusage.services.use で 403 になる。
# 手元の設定を変えずに済むよう、Terraform の実行中だけ指定する
export GOOGLE_CLOUD_QUOTA_PROJECT=zashikiwarashi

# 1. Terraform が使う API の有効化と state バケットの作成
./infra/gcloud/bootstrap.sh

# 2. Workload Identity Federation・サービスアカウント・API を作る
cd infra/terraform
terraform init
terraform plan
terraform apply
```

作られるもの（`main.tf`・`iam_wif.tf`）:

| リソース | 内容 |
| :--- | :--- |
| API | Cloud Resource Manager・IAM・IAM Credentials・Service Usage・STS・Cloud Storage |
| Workload Identity Pool `github` / Provider `github-actions` | GitHub Actions の OIDC トークンを受け付ける。リポジトリ ID `1377113469`（`akakura-hackathon/zashikiwarashi`）以外は拒否 |
| サービスアカウント `tf-plan` | plan 用。閲覧系のロールと state の読み取りのみ。このリポジトリのすべてのワークフロー（PR を含む）から使える |
| サービスアカウント `tf-apply` | apply 用。Terraform で管理するリソースに必要なロールのみ（owner / editor は付けない）。main ブランチのワークフローからだけ使える |
| サービスアカウント `deployer` | デプロイ用。ロールはステップ 3 で追加する。main ブランチのワークフローからだけ使える |

## apply 後の作業

`terraform output` の値を GitHub リポジトリの **Variables**（Settings → Secrets and variables → Actions → Variables）に登録する。秘密情報ではないので Secrets ではなく Variables に置く。

| Variable | terraform output |
| :--- | :--- |
| `GCP_PROJECT_ID` | `project_id` |
| `GCP_REGION` | `region` |
| `GCP_WIF_PROVIDER` | `workload_identity_provider` |
| `GCP_TF_PLAN_SA` | `tf_plan_service_account` |
| `GCP_TF_APPLY_SA` | `tf_apply_service_account` |
| `GCP_DEPLOYER_SA` | `deployer_service_account` |

## ステップ 3b の手作業（1 回だけ）

Terraform で作らないもの。OAuth クライアントのシークレットを Terraform の state に残さないため、Google ログインは Firebase Console で有効にする。

1. **Google ログインを有効にする**: [Firebase Console](https://console.firebase.google.com/project/zashikiwarashi/authentication/providers) → Authentication →（初回は「始める」）→ Sign-in method → 「Google」を有効にし、プロジェクトのサポートメールを選んで保存する。OAuth クライアントは自動で作られる。
2. **許可ドメインを確認する**: Authentication → Settings → 承認済みドメイン に `zashikiwarashi.web.app` と `zashikiwarashi.firebaseapp.com` があること（Hosting のサイト ID をプロジェクト ID にしているので既定で入る）。
3. **ロールを付ける**: 本人が画面（`https://zashikiwarashi.web.app`）から Google ログインを 1 回行ってから、`backend/scripts/set_claims.py` でロールを付ける。ロールが無いユーザーは API で 403 になる。

```sh
cd backend
export GOOGLE_CLOUD_QUOTA_PROJECT=zashikiwarashi
uv run python scripts/set_claims.py --email ADMIN@example.com --role admin --building-id B-001
uv run python scripts/set_claims.py --email RESIDENT@example.com --role resident --building-id B-001 --unit-id U-301
```

## 注意

- `tf-apply`・`deployer` は「main ブランチで動くワークフロー」なら使える。ワークフローに `pull_request_target` トリガーを使わないこと（PR のコードが main の権限で動いてしまうため）。
- `tf-apply` の `roles/resourcemanager.projectIamAdmin` は IAM を Terraform で管理するために必要だが、権限の付け替えができる強いロール。main ブランチへのマージは PR のレビューを通すこと。
- ロールを追加するときは `iam_wif.tf` の `tf_apply_roles` / `deployer_roles` に足す。
- `tf_apply_roles` にロールを足す変更は、`tf-apply` 自身が新しいロールを使う前に権限の反映が間に合わず、`deploy.yml` の apply が失敗することがある。その PR はマージ前にオーナーがローカルで apply しておく（PR の plan で内容を確認してから）。

# Infra Rules (Terraform)

## シングル環境方針
このテンプレートは GCP 環境を1つだけ作る前提で設計されている（dev/stg/prod のような複数環境分割は行わない）。
`infra/terraform/` に environments フォルダや workspace は作らず、`terraform.tfvars` 1つで管理する。

## State管理
- state は GCS backend に置く（GitHub Actions が apply するため）。state 用のバケットは初回構築で1回だけ手動で作る（`docs/ARCHITECTURE.md` §6.1）。
- ローカルの `terraform.tfstate` は作らない・コミットしない（`.gitignore` 済み）。

## 実行の流れ
- PR で `ci.yml` が `terraform plan` を実行し、結果を PR にコメントする。main へのマージで `deploy.yml` が `terraform apply` する。
- ローカルからの `apply` は初回構築と障害対応のときだけにする。行った場合は、その内容を PR にも残す。

## 秘密情報
- `google_secret_manager_secret_version` で実際のシークレット値を Terraform 管理しない（state に平文で残るため）。
- シークレットの値は `gcloud secrets versions add` または Console から手動で追加する。

## Terraform 化しないリソース
- Terraform の google / google-beta provider で作れるリソースは Terraform で管理する。
- provider が未対応のリソース・設定（Agent Gateway 周りで gcloud の alpha / beta でしか作れないものなど）は Terraform 化しなくてよい。
- その場合は、実行した gcloud コマンドを `infra/gcloud/` にスクリプトとして残し、手順を再現できるようにする。Console での手作業だけで済ませない。
- provider が対応したら Terraform に移し、`terraform import` で state に取り込む。

## 権限
- デプロイ用サービスアカウントには `owner`/`editor` を付与せず、`roles/run.admin` 等の必要最小限のロールのみ付与する（`iam_wif.tf` 参照）。

## 変更後の運用
- `terraform output` の値（WIF Provider 名・サービスアカウントのメールなど）が変わったら、GitHub リポジトリの Variables にコピーする（`infra/terraform/README.md` 参照）。秘密情報ではないので Secrets ではなく Variables に置く。

# Infra Rules (Terraform)

## シングル環境方針
このテンプレートは GCP 環境を1つだけ作る前提で設計されている（dev/stg/prod のような複数環境分割は行わない）。
`infra/terraform/` に environments フォルダや workspace は作らず、`terraform.tfvars` 1つで管理する。

## State管理
- デフォルトはローカル state（`terraform.tfstate` はコミットしない、`.gitignore` 済み）。
- 複数人で `terraform apply` を行うようになった場合のみ、`provider.tf` にコメントアウトしてある GCS backend を有効化する。

## 秘密情報
- `google_secret_manager_secret_version` で実際のシークレット値を Terraform 管理しない（state に平文で残るため）。
- シークレットの値は `gcloud secrets versions add` または Console から手動で追加する。

## 権限
- デプロイ用サービスアカウントには `owner`/`editor` を付与せず、`roles/run.admin` 等の必要最小限のロールのみ付与する（`iam_wif.tf` 参照）。

## 変更後の運用
- `terraform apply` 後に `terraform output` の値を GitHub リポジトリの Variables/Secrets にコピーする（`infra/terraform/README.md` 参照）。

variable "project_id" {
  type        = string
  description = "GCP project ID"
  default     = "zashikiwarashi"
}

variable "region" {
  type        = string
  description = "Default region（単一リージョン。docs/ARCHITECTURE.md §3.4.1）"
  default     = "us-central1"
}

variable "tfstate_bucket" {
  type        = string
  description = "Terraform の state 用 GCS バケット（初回構築で手動作成。provider.tf の backend と同じ名前）"
  default     = "zashikiwarashi-tfstate"
}

variable "github_repository" {
  type        = string
  description = "GitHub Actions から認証を許可するリポジトリ（owner/name）"
  default     = "akakura-hackathon/zashikiwarashi"
}

variable "github_repository_id" {
  type        = string
  description = "GitHub リポジトリの数値 ID。名前は変更・再作成できるため、WIF の受け付け条件には変わらない ID を使う（gh api repos/OWNER/REPO --jq .id）"
  default     = "1377113469"
}

variable "github_main_ref" {
  type        = string
  description = "apply・デプロイを許可するブランチの ref"
  default     = "refs/heads/main"
}

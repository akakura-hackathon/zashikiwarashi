# FN-02: GitHub Actions から鍵なしで GCP に認証するための Workload Identity Federation と、
# Actions が使うサービスアカウント（docs/ARCHITECTURE.md §6.1、rules/infra.md）。
# owner / editor は付けない。ロールは必要になったステップで追加する。

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "GitHub Actions (${var.github_repository}) からの認証"

  depends_on = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository"    = "assertion.repository"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.ref"           = "assertion.ref"
    "attribute.event_name"    = "assertion.event_name"
  }

  # このリポジトリ以外からのトークンは受け付けない（名前ではなく変わらない ID で判定する）
  attribute_condition = "assertion.repository_id == \"${var.github_repository_id}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  wif_pool_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}"

  # PR を含むリポジトリ内のすべてのワークフロー（plan 用）
  wif_repository_principal = "${local.wif_pool_principal}/attribute.repository_id/${var.github_repository_id}"

  # main ブランチで動くワークフローだけ（apply・デプロイ用）。リポジトリは provider の attribute_condition で限定済み
  wif_main_principal = "${local.wif_pool_principal}/attribute.ref/${var.github_main_ref}"
}

# ---------------------------------------------------------------------------
# サービスアカウント
# ---------------------------------------------------------------------------

resource "google_service_account" "tf_plan" {
  account_id   = "tf-plan"
  display_name = "Terraform plan (GitHub Actions / PR)"
  description  = "ci.yml の terraform plan 用。閲覧のみ"

  depends_on = [google_project_service.bootstrap]
}

resource "google_service_account" "tf_apply" {
  account_id   = "tf-apply"
  display_name = "Terraform apply (GitHub Actions / main)"
  description  = "deploy.yml の terraform apply 用。main ブランチからのみ使える"

  depends_on = [google_project_service.bootstrap]
}

resource "google_service_account" "deployer" {
  account_id   = "deployer"
  display_name = "Deployer (GitHub Actions / main)"
  description  = "deploy.yml のデプロイ用（Cloud Run・Artifact Registry・Firebase Hosting・Agent Runtime）。main ブランチからのみ使える"

  depends_on = [google_project_service.bootstrap]
}

# ---------------------------------------------------------------------------
# プロジェクトのロール
# ---------------------------------------------------------------------------

locals {
  tf_plan_roles = [
    "roles/viewer",
    "roles/iam.securityReviewer", # IAM ポリシーの読み取り（plan で差分を取るため）
  ]

  # Terraform で管理するリソースに必要なロール。ステップ 3 以降で管理対象が増えたら追加する。
  # resourcemanager.projectIamAdmin は IAM を Terraform で管理するために必要。main ブランチからしか使えないようにしている。
  tf_apply_roles = [
    "roles/iam.serviceAccountAdmin",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/serviceusage.serviceUsageAdmin",
  ]

  # ステップ 3 で Cloud Run・Artifact Registry などを作るときに追加する
  deployer_roles = []
}

resource "google_project_iam_member" "tf_plan" {
  for_each = toset(local.tf_plan_roles)

  project = var.project_id
  role    = each.value
  member  = google_service_account.tf_plan.member
}

resource "google_project_iam_member" "tf_apply" {
  for_each = toset(local.tf_apply_roles)

  project = var.project_id
  role    = each.value
  member  = google_service_account.tf_apply.member
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)

  project = var.project_id
  role    = each.value
  member  = google_service_account.deployer.member
}

# state バケット: plan は読み取りのみ（ci.yml では -lock=false で実行する）、apply は読み書き
resource "google_storage_bucket_iam_member" "tfstate_plan" {
  bucket = var.tfstate_bucket
  role   = "roles/storage.objectViewer"
  member = google_service_account.tf_plan.member
}

resource "google_storage_bucket_iam_member" "tfstate_apply" {
  bucket = var.tfstate_bucket
  role   = "roles/storage.objectAdmin"
  member = google_service_account.tf_apply.member
}

# ---------------------------------------------------------------------------
# GitHub Actions がサービスアカウントとして振る舞うことを許可する
# ---------------------------------------------------------------------------

resource "google_service_account_iam_member" "tf_plan_wif" {
  service_account_id = google_service_account.tf_plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_repository_principal
}

resource "google_service_account_iam_member" "tf_apply_wif" {
  service_account_id = google_service_account.tf_apply.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_main_principal
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_main_principal
}

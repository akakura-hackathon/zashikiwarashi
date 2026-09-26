data "google_project" "this" {
  project_id = var.project_id
}

# 初回構築（ステップ 1）で必要な API。以降のステップで使う API はそのステップで追加する。
locals {
  bootstrap_services = [
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "bootstrap" {
  for_each = toset(local.bootstrap_services)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# TODO(ステップ 3): Artifact Registry、Firestore、Firebase、Cloud Run、Secret Manager など

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

# ステップ 3a: Artifact Registry・Cloud Run
locals {
  platform_services = [
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "logging.googleapis.com",
    "cloudtrace.googleapis.com",
  ]
}

resource "google_project_service" "platform" {
  for_each = toset(local.platform_services)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ステップ 3b: Firestore・Firebase（Auth・Hosting）・API Gateway
locals {
  firebase_services = [
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "identitytoolkit.googleapis.com",
    "apigateway.googleapis.com",
    "servicemanagement.googleapis.com",
    "servicecontrol.googleapis.com",
  ]
}

resource "google_project_service" "firebase" {
  for_each = toset(local.firebase_services)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

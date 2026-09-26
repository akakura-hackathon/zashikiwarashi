# GitHub リポジトリの Variables に登録する値（infra/terraform/README.md「apply 後の作業」）

output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "workload_identity_provider" {
  description = "GitHub Variables: GCP_WIF_PROVIDER（google-github-actions/auth の workload_identity_provider）"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "tf_plan_service_account" {
  description = "GitHub Variables: GCP_TF_PLAN_SA"
  value       = google_service_account.tf_plan.email
}

output "tf_apply_service_account" {
  description = "GitHub Variables: GCP_TF_APPLY_SA"
  value       = google_service_account.tf_apply.email
}

output "deployer_service_account" {
  description = "GitHub Variables: GCP_DEPLOYER_SA"
  value       = google_service_account.deployer.email
}

output "backend_image_repository" {
  description = "backend イメージの保存先（deploy.yml が <この値>/backend:<commit SHA> で push する）"
  value       = "${google_artifact_registry_repository.backend.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.backend.repository_id}"
}

output "api_url" {
  description = "API Ingestion（Cloud Run）の URL"
  value       = google_cloud_run_v2_service.service["api"].uri
}

output "tools_url" {
  description = "ツールサービス（Cloud Run・非公開）の URL"
  value       = google_cloud_run_v2_service.service["tools"].uri
}

output "api_gateway_url" {
  description = "画面から呼ぶ API の URL（API Gateway。Firebase の ID トークンが必要）"
  value       = "https://${google_api_gateway_gateway.api.default_hostname}"
}

output "hosting_url" {
  description = "画面（Firebase Hosting）の URL"
  value       = "https://${google_firebase_hosting_site.web.site_id}.web.app"
}

# frontend のビルド時に NEXT_PUBLIC_FIREBASE_* として埋め込む。Web 用の API キーはブラウザに配る前提の識別子で秘密情報ではない
output "firebase_web_config" {
  description = "Firebase Web アプリの設定（deploy.yml が frontend のビルドに使う）"
  value = {
    api_key             = data.google_firebase_web_app_config.web.api_key
    auth_domain         = data.google_firebase_web_app_config.web.auth_domain
    project_id          = var.project_id
    storage_bucket      = lookup(data.google_firebase_web_app_config.web, "storage_bucket", "")
    messaging_sender_id = lookup(data.google_firebase_web_app_config.web, "messaging_sender_id", "")
    app_id              = google_firebase_web_app.web.app_id
  }
}

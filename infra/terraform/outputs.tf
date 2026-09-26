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

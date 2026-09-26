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

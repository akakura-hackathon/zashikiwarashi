# ステップ 7: Agent ガバナンス・Agent Identity（docs/ARCHITECTURE.md §3.4、PLAN §4 ステップ 7）
# - building-agent-sa: Building Agent Coordinator 用の実行アイデンティティ
# - resident-agent-sa: Resident Agent 用の実行アイデンティティ
# 最小権限原則（Domain Principles 4 / REQ-13）に基づき、必要最小限のロールのみを付与する。

locals {
  agent_identities = {
    "building-agent" = "Building Agent Coordinator の実行アイデンティティ"
    "resident-agent" = "Resident Agent の実行アイデンティティ"
  }

  agent_roles = [
    "roles/logging.logWriter",
    "roles/aiplatform.user",
    "roles/cloudtrace.agent",
  ]

  agent_role_bindings = {
    for pair in setproduct(keys(local.agent_identities), local.agent_roles) :
    "${pair[0]}/${pair[1]}" => { agent = pair[0], role = pair[1] }
  }
}

resource "google_service_account" "agent" {
  for_each = local.agent_identities

  account_id   = "${each.key}-sa"
  display_name = each.value

  depends_on = [google_project_service.governance]
}

resource "google_project_iam_member" "agent" {
  for_each = local.agent_role_bindings

  project = var.project_id
  role    = each.value.role
  member  = google_service_account.agent[each.value.agent].member
}

output "building_agent_service_account" {
  description = "Building Agent のサービスアカウント（Agent Identity）"
  value       = google_service_account.agent["building-agent"].email
}

output "resident_agent_service_account" {
  description = "Resident Agent のサービスアカウント（Agent Identity）"
  value       = google_service_account.agent["resident-agent"].email
}

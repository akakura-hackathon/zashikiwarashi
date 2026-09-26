# ステップ 3a: Artifact Registry と Cloud Run（docs/ARCHITECTURE.md §3.4.1・§6.2）
# - api:   API Ingestion。非公開（画面からの呼び出し方はステップ 3b で決める）
# - tools: ツールサービス（MCP）。非公開。ステップ 7 で Agent Gateway 経由で呼ばれるようにする
# 2 つのサービスは同じ backend イメージを使う。イメージの更新は deploy.yml が行い、Terraform は変更を無視する。

resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "zashikiwarashi"
  format        = "DOCKER"
  description   = "backend のコンテナイメージ"

  # 古いイメージを溜めない（直近 10 個を残す）
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 日
    }
  }

  depends_on = [google_project_service.platform]
}

# ---------------------------------------------------------------------------
# 実行用サービスアカウント
# ---------------------------------------------------------------------------

locals {
  runtime_services = {
    api   = "API Ingestion（Cloud Run）"
    tools = "ツールサービス（Cloud Run・MCP）"
  }

  # 実行時に必要なロール。Firestore（roles/datastore.user）はステップ 3b で追加する
  runtime_roles = [
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
  ]

  runtime_role_bindings = {
    for pair in setproduct(keys(local.runtime_services), local.runtime_roles) :
    "${pair[0]}/${pair[1]}" => { service = pair[0], role = pair[1] }
  }

  # 初回作成時だけ使うプレースホルダーのイメージ。以降は deploy.yml が backend のイメージに差し替える
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
}

resource "google_service_account" "runtime" {
  for_each = local.runtime_services

  account_id   = "${each.key}-runtime"
  display_name = "${each.value} の実行用"

  depends_on = [google_project_service.bootstrap]
}

resource "google_project_iam_member" "runtime" {
  for_each = local.runtime_role_bindings

  project = var.project_id
  role    = each.value.role
  member  = google_service_account.runtime[each.value.service].member
}

# deployer が Cloud Run を更新するとき、実行用サービスアカウントを使う権限が要る
resource "google_service_account_iam_member" "deployer_runtime_user" {
  for_each = local.runtime_services

  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# ---------------------------------------------------------------------------
# Cloud Run
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "service" {
  for_each = local.runtime_services

  name     = each.key
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # ハッカソン中は作り直しを許す
  deletion_protection = false

  template {
    service_account = google_service_account.runtime[each.key].email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.placeholder_image

      env {
        name  = "ENVIRONMENT"
        value = "production"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }
      # 画面（Firebase Hosting）からの呼び出しを許可するオリジン（API Gateway は OPTIONS を api に通す）
      env {
        name  = "CORS_ALLOW_ORIGINS"
        value = jsonencode(["https://${var.project_id}.web.app", "https://${var.project_id}.firebaseapp.com", "http://localhost:3000"])
      }
    }
  }

  lifecycle {
    # イメージは deploy.yml（gcloud run deploy）が更新する。gcloud が付ける情報も差分にしない
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.platform]
}

# api・tools とも非公開（allUsers に呼び出しを許可しない）。呼び出せるのは run.invoker を持つ ID だけ。
# 画面（frontend）から api を呼ぶ方法はステップ 3b で決める（IAP で許可した Google アカウントに限定する、など）。
# deploy.yml の動作確認（/health）のため、deployer にだけ api の呼び出しを許可する。
resource "google_cloud_run_v2_service_iam_member" "api_deployer_invoker" {
  name     = google_cloud_run_v2_service.service["api"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.deployer.member
}

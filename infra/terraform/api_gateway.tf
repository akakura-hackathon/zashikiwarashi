# ステップ 3b: API Gateway（docs/ARCHITECTURE.md §3.1）
# 画面 → API Gateway（Firebase の ID トークンを検証）→ 非公開の Cloud Run（api）
# API 定義は infra/api-gateway/openapi.yaml.tftpl。API 設定は作成後に変更できないため、定義が変わるたびに
# 新しい設定を作ってから古い設定を消す（create_before_destroy）。

resource "google_service_account" "api_gateway" {
  account_id   = "api-gateway"
  display_name = "API Gateway（api の呼び出し用）"

  depends_on = [google_project_service.bootstrap]
}

# 非公開の api を呼べるのは、この Gateway と deployer（動作確認用）だけ
resource "google_cloud_run_v2_service_iam_member" "api_gateway_invoker" {
  name     = google_cloud_run_v2_service.service["api"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.api_gateway.member
}

resource "google_api_gateway_api" "api" {
  provider     = google-beta
  api_id       = "zashikiwarashi-api"
  display_name = "Zashikiwarashi API"

  depends_on = [google_project_service.firebase]
}

locals {
  openapi_document = templatefile("${path.module}/../api-gateway/openapi.yaml.tftpl", {
    project_id      = var.project_id
    backend_url     = google_cloud_run_v2_service.service["api"].uri
    managed_service = google_api_gateway_api.api.managed_service
  })
}

resource "google_api_gateway_api_config" "api" {
  provider = google-beta
  api      = google_api_gateway_api.api.api_id

  # 定義の中身が変わったら別名の設定を作る
  api_config_id = "cfg-${substr(sha256(local.openapi_document), 0, 12)}"

  openapi_documents {
    document {
      path     = "openapi.yaml"
      contents = base64encode(local.openapi_document)
    }
  }

  gateway_config {
    backend_config {
      google_service_account = google_service_account.api_gateway.email
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_api_gateway_gateway" "api" {
  provider     = google-beta
  region       = var.region
  gateway_id   = "zashikiwarashi-gw"
  api_config   = google_api_gateway_api_config.api.id
  display_name = "Zashikiwarashi API Gateway"
}

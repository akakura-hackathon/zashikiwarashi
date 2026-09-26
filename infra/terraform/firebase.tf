# ステップ 3b: Firestore と Firebase（docs/DESIGN.md §7.3、docs/ARCHITECTURE.md §3.1・§6.2）
# - Firestore: (default)・ネイティブモード・us-central1。セキュリティルールとインデックスは
#   リポジトリの firestore.rules / firestore.indexes.json を正とし、deploy.yml が Firebase CLI でデプロイする
# - Firebase: プロジェクトの有効化・Web アプリ・Hosting サイト
# - Authentication の Google ログインは Firebase Console で手動で有効にする（OAuth クライアントのシークレットを
#   Terraform の state に残さないため。infra/terraform/README.md）

resource "google_firestore_database" "default" {
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.firebase]
}

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.firebase]
}

resource "google_firebase_web_app" "web" {
  provider     = google-beta
  display_name = "zashikiwarashi-web"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.web.app_id
}

# サイト ID をプロジェクト ID にすると、URL（<project>.web.app）が Firebase Authentication の既定の許可ドメインに入る
resource "google_firebase_hosting_site" "web" {
  provider = google-beta
  site_id  = var.project_id
  app_id   = google_firebase_web_app.web.app_id

  depends_on = [google_firebase_project.this]
}

# api が Firestore を読み書きする（ツールサービスの権限はステップ 4 で必要になったら足す）
resource "google_project_iam_member" "api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.runtime["api"].member
}

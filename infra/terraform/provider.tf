terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
  }

  # state 用のバケットは初回構築で手動作成する（infra/gcloud/bootstrap.sh、docs/ARCHITECTURE.md §6.1）
  backend "gcs" {
    bucket = "zashikiwarashi-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

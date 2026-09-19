variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type        = string
  description = "Default region"
  default     = "us-central1"
}

# TODO: GitHub repo (owner/name) for Workload Identity Federation, Cloud Run
# service name, Firebase Hosting site ID, etc.

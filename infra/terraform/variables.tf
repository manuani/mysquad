variable "aws_region" {
  description = "AWS region. Mumbai per ADR 012 (docs/adr/012-hosting-aws-india-region.md)."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment name. Used in resource naming and tags."
  type        = string
  default     = "staging"
}

variable "project_name" {
  description = "Short name used as a prefix for resource naming."
  type        = string
  default     = "voai"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC. Small block — this is a staging environment for one application, not a platform with room to grow into /16."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread subnets across. 2 is the minimum RDS/ElastiCache require for multi-AZ-capable subnet groups; staying at 2 (not 3) keeps the NAT gateway count and subnet count down for a small-team cost-optimized staging environment."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is Graviton-based (cheaper than t3) and adequate for staging traffic — Sprint Plan's design-partner phase is 10-15 founders, not production load."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB. gp3 storage below 20GB is billed at the same rate as 20GB, so 20 is the practical floor."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Initial database name created by RDS."
  type        = string
  default     = "voai_staging"
}

variable "db_master_username" {
  description = "RDS master (superuser) username — used only for running migrations, per ADR 010's two-role pattern. The application connects as a separate, more restricted role created by the migration that already exists for local dev (infra/docker/init/postgres/002_app_role.sql) — the equivalent statement needs to run once against this RDS instance after first apply, since Terraform provisions infrastructure, not application-level Postgres roles within a database."
  type        = string
  default     = "voai_admin"
}

variable "db_master_password" {
  description = "RDS master password. Pass via TF_VAR_db_master_password or a tfvars file that is gitignored — never commit this. Stored in AWS Secrets Manager (secrets.tf) for the running application to retrieve at boot, not passed as a plain environment variable."
  type        = string
  sensitive   = true
}

variable "db_app_role_password" {
  description = "Password for the non-superuser application role (voai_app equivalent) that the running app actually connects as. Set via TF_VAR_db_app_role_password. Same ADR 010 reasoning as the local dev stack — the app must never connect as the migration superuser, because Postgres superusers bypass row-level security regardless of FORCE ROW LEVEL SECURITY."
  type        = string
  sensitive   = true
}

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.micro — same Graviton cost-optimization reasoning as the RDS instance class."
  type        = string
  default     = "cache.t4g.micro"
}

variable "neo4j_aura_uri" {
  description = "Neo4j AuraDB connection URI. AuraDB is its own managed SaaS — cloud-agnostic, provisioned separately at https://console.neo4j.io, not a Terraform-managed AWS resource (System Architecture §4.1; ADR 012 notes this explicitly). Set via TF_VAR_neo4j_aura_uri once an AuraDB instance exists."
  type        = string
  sensitive   = true
}

variable "neo4j_aura_user" {
  description = "Neo4j AuraDB username."
  type        = string
  sensitive   = true
  default     = "neo4j"
}

variable "neo4j_aura_password" {
  description = "Neo4j AuraDB password."
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key for the routing service. Set via TF_VAR_anthropic_api_key. Stored in Secrets Manager, injected into the App Runner service at runtime — never baked into the container image or committed."
  type        = string
  sensitive   = true
}

variable "ecr_image_tag" {
  description = "The container image tag App Runner deploys. The CI workflow (.github/workflows/deploy-staging.yml) pushes a new tag on every merge to main and triggers a fresh App Runner deployment — this variable's default is a placeholder for the very first `terraform apply`, before any image has been pushed."
  type        = string
  default     = "latest"
}

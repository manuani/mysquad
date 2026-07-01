output "api_server_url" {
  description = "Public URL of the deployed API server (ALB DNS name — see ADR 012's 2026-06-29 amendment for why this is an ALB, not an App Runner URL)."
  value       = "http://${aws_lb.main.dns_name}"
}

output "ecs_cluster_name" {
  description = "ECS cluster name, for `aws ecs describe-services`."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name, for `aws ecs describe-services`."
  value       = aws_ecs_service.api_server.name
}

output "ecr_repository_url" {
  description = "Push images here from CI."
  value       = aws_ecr_repository.api_server.repository_url
}

output "rds_endpoint" {
  description = "Postgres endpoint (private — not reachable outside the VPC)."
  value       = aws_db_instance.postgres.address
}

output "redis_endpoint" {
  description = "Redis endpoint (private — not reachable outside the VPC)."
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "object_store_bucket" {
  description = "S3 bucket name for OBJECT_STORE_BUCKET."
  value       = aws_s3_bucket.object_store.bucket
}

output "terraform_state_bucket" {
  description = "S3 bucket for migrating to a remote backend (see versions.tf)."
  value       = aws_s3_bucket.terraform_state.bucket
}

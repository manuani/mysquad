/**
 * Every credential the running application needs, stored in Secrets
 * Manager rather than as plain App Runner environment variables — App
 * Runner supports referencing Secrets Manager values directly as env
 * vars at the container level (apprunner.tf's `runtime_environment_secrets`),
 * so secrets never appear in the App Runner service definition itself or
 * in any CI log.
 */

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.project_name}/${var.environment}/database-url"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # Connects as the restricted application role per ADR 010 — NOT
  # db_master_username. The role itself is created by a one-time manual
  # SQL step after first apply (see README "First-time setup"); this
  # secret assumes that role already exists.
  secret_string = "postgres://voai_app:${var.db_app_role_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
}

resource "aws_secretsmanager_secret" "migrations_database_url" {
  name = "${var.project_name}/${var.environment}/migrations-database-url"
}

resource "aws_secretsmanager_secret_version" "migrations_database_url" {
  secret_id     = aws_secretsmanager_secret.migrations_database_url.id
  secret_string = "postgres://${var.db_master_username}:${var.db_master_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name = "${var.project_name}/${var.environment}/redis-url"
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
}

resource "aws_secretsmanager_secret" "neo4j_uri" {
  name = "${var.project_name}/${var.environment}/neo4j-uri"
}

resource "aws_secretsmanager_secret_version" "neo4j_uri" {
  secret_id     = aws_secretsmanager_secret.neo4j_uri.id
  secret_string = var.neo4j_aura_uri
}

resource "aws_secretsmanager_secret" "neo4j_password" {
  name = "${var.project_name}/${var.environment}/neo4j-password"
}

resource "aws_secretsmanager_secret_version" "neo4j_password" {
  secret_id     = aws_secretsmanager_secret.neo4j_password.id
  secret_string = var.neo4j_aura_password
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name = "${var.project_name}/${var.environment}/anthropic-api-key"
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}

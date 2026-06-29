/**
 * Postgres with pgvector. RDS Postgres 16 supports `CREATE EXTENSION
 * vector` directly (no parameter-group preload needed for pgvector
 * specifically, unlike some other extensions) — matches the local dev
 * stack's pgvector/pgvector:pg16 image (infra/docker/docker-compose.yml).
 *
 * Per ADR 010, the master user here is the migration superuser
 * equivalent — used only to run migrations and to create the restricted
 * application role. The app's actual runtime connection (DATABASE_URL,
 * via Secrets Manager) uses that restricted role, not this master user.
 * Terraform provisions the RDS instance; it does NOT run
 * `CREATE ROLE voai_app ...` inside the database — that's an application-
 * level SQL statement, not infrastructure. Run it once after the first
 * apply (see infra/terraform/README.md "First-time setup").
 */

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${var.project_name}-${var.environment}-db-subnets" }
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project_name}-${var.environment}-postgres"
  engine         = "postgres"
  engine_version = "16.4"

  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage_gb
  storage_type          = "gp3"
  max_allocated_storage = var.db_allocated_storage_gb * 3 # storage autoscaling ceiling, not a fixed allocation

  db_name  = var.db_name
  username = var.db_master_username
  password = var.db_master_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # Staging, not production: skip the final snapshot on destroy, keep
  # backup retention short. Revisit when this environment graduates past
  # the design-partner phase (Strategic Vision §8.1/§8.2).
  skip_final_snapshot     = true
  backup_retention_period = 3
  multi_az                = false

  tags = { Name = "${var.project_name}-${var.environment}-postgres" }
}

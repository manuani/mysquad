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
  engine = "postgres"
  # 16.4 (this file's original value) is not offered in ap-south-1 as of
  # this apply — `aws rds describe-db-engine-versions` showed 16.9-16.14
  # available. Pinned to 16.9 (oldest available in the 16.x line) rather
  # than "latest" so engine_version stays a stable, intentional choice
  # instead of drifting on every apply as AWS adds newer minors.
  engine_version = "16.9"

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

  # Staging, not production: skip the final snapshot on destroy. Backup
  # retention is 0 (disabled) — new AWS accounts in the free-tier
  # promotional period reject any non-zero retention period
  # (FreeTierRestrictionError, found applying this exact configuration).
  # Revisit once this account ages out of that restriction and when this
  # environment graduates past the design-partner phase (Strategic Vision
  # §8.1/§8.2) — a staging/demo environment with no real customer data
  # doesn't strictly need automated backups, but production will.
  skip_final_snapshot     = true
  backup_retention_period = 0
  multi_az                = false

  tags = { Name = "${var.project_name}-${var.environment}-postgres" }
}

/**
 * App Runner — the API server pool (System Architecture §3.7), chosen
 * over Fargate/ECS for the first staging deployment specifically because
 * it needs no ALB, no target groups, no task-definition/service YAML to
 * own — the lowest-ops option for a team with no dedicated infra hire
 * (ADR 012). Fargate remains the documented upgrade path if networking
 * control needs grow past what App Runner exposes.
 */

resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "${var.project_name}-${var.environment}-connector"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.app_runner_vpc_connector.id]
}

# --- IAM ---

# Access role: lets App Runner pull the image from ECR.
resource "aws_iam_role" "apprunner_access" {
  name = "${var.project_name}-${var.environment}-apprunner-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "build.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_access_ecr" {
  role       = aws_iam_role.apprunner_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# Instance role: what the running container itself can do at runtime —
# scoped to exactly the secrets it needs, nothing else.
resource "aws_iam_role" "apprunner_instance" {
  name = "${var.project_name}-${var.environment}-apprunner-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "tasks.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "apprunner_instance_secrets" {
  name = "${var.project_name}-${var.environment}-apprunner-secrets-read"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.migrations_database_url.arn,
        aws_secretsmanager_secret.redis_url.arn,
        aws_secretsmanager_secret.neo4j_uri.arn,
        aws_secretsmanager_secret.neo4j_password.arn,
        aws_secretsmanager_secret.anthropic_api_key.arn,
      ]
    }]
  })
}

resource "aws_apprunner_service" "api_server" {
  service_name = "${var.project_name}-${var.environment}-api-server"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }
    image_repository {
      image_identifier      = "${aws_ecr_repository.api_server.repository_url}:${var.ecr_image_tag}"
      image_repository_type = "ECR"
      image_configuration {
        port = "3000"

        runtime_environment_variables = {
          NODE_ENV            = "staging"
          LOG_LEVEL           = "info"
          PORT                = "3000"
          AWS_REGION          = var.aws_region
          NEO4J_USER          = var.neo4j_aura_user
          OBJECT_STORE_BUCKET = aws_s3_bucket.object_store.bucket
          OBJECT_STORE_REGION = var.aws_region
          # OBJECT_STORE_ENDPOINT deliberately omitted — real S3, not MinIO.
        }

        runtime_environment_secrets = {
          DATABASE_URL            = aws_secretsmanager_secret.database_url.arn
          MIGRATIONS_DATABASE_URL = aws_secretsmanager_secret.migrations_database_url.arn
          REDIS_URL               = aws_secretsmanager_secret.redis_url.arn
          NEO4J_URI               = aws_secretsmanager_secret.neo4j_uri.arn
          NEO4J_PASSWORD          = aws_secretsmanager_secret.neo4j_password.arn
          ANTHROPIC_API_KEY       = aws_secretsmanager_secret.anthropic_api_key.arn
        }
      }
    }
    auto_deployments_enabled = true # new image pushed to ECR -> automatic redeploy, no extra CI step needed
  }

  instance_configuration {
    cpu               = "1024" # 1 vCPU
    memory            = "2048" # 2 GB — modular monolith running 11 service modules in one process
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.main.arn
    }
  }

  health_check_configuration {
    protocol = "HTTP"
    path     = "/healthz"
    interval = 10
    timeout  = 5
  }

  tags = { Name = "${var.project_name}-${var.environment}-api-server" }
}

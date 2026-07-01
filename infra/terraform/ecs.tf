/**
 * ECS on Fargate, fronted by an Application Load Balancer — the API
 * server pool (System Architecture §3.7). Replaces the original App
 * Runner plan (ADR 012's 2026-06-29 amendment): App Runner stopped
 * accepting new AWS customers as of 2026-04-30, discovered by actually
 * running `terraform apply` against this account, not by reading docs in
 * advance. This is more Terraform surface (ALB, target group, listener,
 * task definition, cluster) than App Runner would have needed — exactly
 * the ops-burden tradeoff ADR 012 originally chose to avoid, no longer
 * available to choose.
 */

resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-${var.environment}-alb-"
  description = "ALB - public HTTP inbound, all outbound."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from the internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-alb-sg" }
}

resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${var.project_name}-${var.environment}-ecs-"
  description = "ECS tasks - inbound only from the ALB, all outbound."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-ecs-sg" }
}

resource "aws_lb" "main" {
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "${var.project_name}-${var.environment}-alb" }
}

resource "aws_lb_target_group" "api_server" {
  name        = "${var.project_name}-${var.environment}-api-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Fargate awsvpc mode registers tasks by IP, not instance ID

  health_check {
    path                = "/healthz"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.project_name}-${var.environment}-api-tg" }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api_server.arn
  }
}

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "disabled" # extra CloudWatch cost not justified at staging scale
  }

  tags = { Name = "${var.project_name}-${var.environment}-cluster" }
}

resource "aws_cloudwatch_log_group" "api_server" {
  name              = "/ecs/${var.project_name}-${var.environment}-api-server"
  retention_in_days = 14 # staging — short retention, not the 90-day-hot/1-year-cold production target from System Architecture's observability section

  tags = { Name = "${var.project_name}-${var.environment}-api-server-logs" }
}

# --- IAM ---

# Execution role: what ECS itself does on the task's behalf before the
# container starts — pull the image, fetch Secrets Manager values to
# inject as env vars, write to CloudWatch Logs. Not the same as the task
# role below, which is what the running application code can do.
resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-${var.environment}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.project_name}-${var.environment}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

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

# Task role: what the running application itself can do via the AWS SDK
# at runtime. Only S3 (object store) — everything else (Postgres, Redis,
# Neo4j, Anthropic) is reached via plain connection strings/API keys
# injected as env vars by the execution role above, not via AWS-SDK-level
# permissions.
resource "aws_iam_role" "ecs_task" {
  name = "${var.project_name}-${var.environment}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.project_name}-${var.environment}-ecs-task-s3"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = ["${aws_s3_bucket.object_store.arn}/*"]
    }]
  })
}

# --- Task definition and service ---

resource "aws_ecs_task_definition" "api_server" {
  family                   = "${var.project_name}-${var.environment}-api-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024" # 1 vCPU
  memory                   = "2048" # 2 GB — modular monolith running 11 service modules in one process
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api-server"
      image     = "${aws_ecr_repository.api_server.repository_url}:${var.ecr_image_tag}"
      essential = true
      portMappings = [{
        containerPort = 3000
        protocol      = "tcp"
      }]
      environment = [
        { name = "NODE_ENV", value = "staging" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "PORT", value = "3000" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "NEO4J_USER", value = var.neo4j_aura_user },
        { name = "OBJECT_STORE_BUCKET", value = aws_s3_bucket.object_store.bucket },
        { name = "OBJECT_STORE_REGION", value = var.aws_region },
        # OBJECT_STORE_ENDPOINT and OBJECT_STORE_ACCESS_KEY_ID/SECRET
        # deliberately omitted — real S3, credentials resolve from the
        # task role above via the default AWS SDK credential chain, not
        # static keys.
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "MIGRATIONS_DATABASE_URL", valueFrom = aws_secretsmanager_secret.migrations_database_url.arn },
        { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
        { name = "NEO4J_URI", valueFrom = aws_secretsmanager_secret.neo4j_uri.arn },
        { name = "NEO4J_PASSWORD", valueFrom = aws_secretsmanager_secret.neo4j_password.arn },
        { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api_server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api-server"
        }
      }
    }
  ])

  tags = { Name = "${var.project_name}-${var.environment}-api-server-task" }
}

resource "aws_ecs_service" "api_server" {
  name            = "${var.project_name}-${var.environment}-api-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api_server.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api_server.arn
    container_name   = "api-server"
    container_port   = 3000
  }

  # Don't block `terraform apply` waiting for the very first deployment
  # to stabilize — no image has been pushed to ECR yet on first apply
  # (see infra/terraform/README.md step 5), so the first task will fail
  # to pull until CI or a manual push lands an image. The service itself
  # still gets created successfully either way.
  wait_for_steady_state = false

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${var.project_name}-${var.environment}-api-server-service" }
}

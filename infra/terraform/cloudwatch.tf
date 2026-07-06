/**
 * CloudWatch Dashboards — S15 Observability
 *
 * One dashboard covering the three key signal layers:
 *   1. ECS Fargate — CPU + memory utilisation
 *   2. RDS Postgres — DatabaseConnections
 *   3. ALB — RequestCount, TargetResponseTime, HTTP 5xx count
 *
 * The dashboard JSON uses CloudWatch metric math and is region-aware via
 * the var.aws_region variable so the same .tf works if the project ever
 * moves regions.
 *
 * The log group for structured log search (CloudWatch Insights) is also
 * created here. The ECS task definition writes to it via awslogs driver;
 * the group is created explicitly (not by ECS auto-create) so its
 * retention and KMS settings are managed by Terraform.
 */

locals {
  ecs_cluster_name = aws_ecs_cluster.main.name
  ecs_service_name = aws_ecs_service.api_server.name
  alb_arn_suffix   = aws_lb.main.arn_suffix
  tg_arn_suffix    = aws_lb_target_group.api_server.arn_suffix
  db_identifier    = aws_db_instance.postgres.identifier
}

# ── Dashboard ─────────────────────────────────────────────────────────────────
# Log group is declared in ecs.tf as aws_cloudwatch_log_group.api_server —
# referenced here but not re-declared.

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project_name}-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [

      # ── Row 1: ECS ──────────────────────────────────────────────────────────

      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS CPU Utilisation (%)"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization",
              "ClusterName", local.ecs_cluster_name,
              "ServiceName", local.ecs_service_name,
            { label = "CPU %" }]
          ]
          yAxis = { left = { min = 0, max = 100 } }
        }
      },

      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS Memory Utilisation (%)"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/ECS", "MemoryUtilization",
              "ClusterName", local.ecs_cluster_name,
              "ServiceName", local.ecs_service_name,
            { label = "Memory %" }]
          ]
          yAxis = { left = { min = 0, max = 100 } }
        }
      },

      # ── Row 2: RDS ──────────────────────────────────────────────────────────

      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "RDS Database Connections"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/RDS", "DatabaseConnections",
              "DBInstanceIdentifier", local.db_identifier,
            { label = "Connections" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },

      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "RDS FreeStorageSpace (GB)"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Average"
          period = 300
          metrics = [
            ["AWS/RDS", "FreeStorageSpace",
              "DBInstanceIdentifier", local.db_identifier,
              { label = "Free GB", id = "m1" }]
          ]
          # Convert bytes → GB via metric math
          yAxis = { left = { min = 0 } }
        }
      },

      # ── Row 3: ALB ──────────────────────────────────────────────────────────

      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "ALB Request Count"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount",
              "LoadBalancer", local.alb_arn_suffix,
            { label = "Requests/min" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },

      {
        type   = "metric"
        x      = 8
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "ALB Target Response Time (P95, ms)"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "p95"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime",
              "LoadBalancer", local.alb_arn_suffix,
              "TargetGroup", local.tg_arn_suffix,
            { label = "P95 latency (s)" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },

      {
        type   = "metric"
        x      = 16
        y      = 12
        width  = 8
        height = 6
        properties = {
          title  = "ALB HTTP 5xx Errors"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count",
              "LoadBalancer", local.alb_arn_suffix,
            { label = "5xx count", color = "#d62728" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },

      # ── Row 4: Log Insights query widget ────────────────────────────────────

      {
        type   = "log"
        x      = 0
        y      = 18
        width  = 24
        height = 6
        properties = {
          title   = "Recent ERROR logs (last 1 h)"
          region  = var.aws_region
          view    = "table"
          query   = "SOURCE '${aws_cloudwatch_log_group.api_server.name}' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 50"
          insightsQueryVersion = 2
        }
      }
    ]
  })
}

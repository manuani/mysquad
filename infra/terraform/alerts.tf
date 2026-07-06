/**
 * SNS + CloudWatch Alarms — S15 Observability
 *
 * Alert topology:
 *   SNS topic (voai-{env}-alerts)
 *     ├── email subscription  (var.alert_email — set in tfvars)
 *     └── (optional) PagerDuty HTTPS endpoint (var.pagerduty_endpoint)
 *
 * Alarms:
 *   1. ALB 5xx rate > 1 % of requests over 5 min → CRITICAL
 *   2. ECS task failure / task count drops below 1  → CRITICAL
 *   3. ECS CPU > 80 % sustained 10 min → WARNING
 *   4. RDS DatabaseConnections > 80   → WARNING
 *
 * All alarms use treat_missing_data = "notBreaching" so a quiet period
 * (zero traffic) doesn't trigger false pages.
 */

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications. Leave empty to skip the email subscription."
  type        = string
  default     = ""
}

variable "pagerduty_endpoint" {
  description = "PagerDuty Events API v2 HTTPS endpoint for SNS → PagerDuty integration. Leave empty to skip."
  type        = string
  default     = ""
  sensitive   = true
}

# ── SNS topic ──────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-${var.environment}-alerts"

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_subscription" "pagerduty" {
  count     = var.pagerduty_endpoint != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "https"
  endpoint  = var.pagerduty_endpoint
}

# ── Alarm 1: ALB 5xx rate ──────────────────────────────────────────────────────
# Triggers when 5xx errors exceed 1% of total requests over a 5-minute window.
# Uses metric math: 5xx_count / (request_count + 0.001) to avoid divide-by-zero.

resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate" {
  alarm_name          = "${var.project_name}-${var.environment}-alb-5xx-rate"
  alarm_description   = "ALB HTTP 5xx error rate exceeded 1% of requests over 5 minutes."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 1 # percent
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "100 * m5xx / (m_req + 0.001)"
    label       = "5xx Rate (%)"
    return_data = true
  }

  metric_query {
    id = "m5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = local.alb_arn_suffix }
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "m_req"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = { LoadBalancer = local.alb_arn_suffix }
      period      = 300
      stat        = "Sum"
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project_name, Environment = var.environment }
}

# ── Alarm 2: ECS running task count < 1 ──────────────────────────────────────
# Detects task crashes / failed deployments leaving the service with zero tasks.

resource "aws_cloudwatch_metric_alarm" "ecs_task_count" {
  alarm_name          = "${var.project_name}-${var.environment}-ecs-task-count"
  alarm_description   = "ECS service has 0 running tasks — service may be down."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  period              = 60
  threshold           = 1
  statistic           = "Average"
  treat_missing_data  = "breaching" # no data = task crashed

  namespace   = "ECS/ContainerInsights"
  metric_name = "RunningTaskCount"
  dimensions = {
    ClusterName = local.ecs_cluster_name
    ServiceName = local.ecs_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project_name, Environment = var.environment }
}

# ── Alarm 3: ECS CPU > 80% for 10 min ────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${var.project_name}-${var.environment}-ecs-cpu-high"
  alarm_description   = "ECS CPU utilisation above 80% for 10 consecutive minutes."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  threshold           = 80
  statistic           = "Average"
  treat_missing_data  = "notBreaching"

  namespace   = "AWS/ECS"
  metric_name = "CPUUtilization"
  dimensions = {
    ClusterName = local.ecs_cluster_name
    ServiceName = local.ecs_service_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project_name, Environment = var.environment }
}

# ── Alarm 4: RDS connections > 80 ────────────────────────────────────────────
# db.t4g.micro max_connections ≈ 110 (LEAST(DBInstanceClassMemory/9531392, 100) + overhead).
# Alert at 80 to give headroom before the connection pool is exhausted.

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${var.project_name}-${var.environment}-rds-connections-high"
  alarm_description   = "RDS database connections above 80 — approaching max_connections limit."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 60
  threshold           = 80
  statistic           = "Average"
  treat_missing_data  = "notBreaching"

  namespace   = "AWS/RDS"
  metric_name = "DatabaseConnections"
  dimensions = {
    DBInstanceIdentifier = local.db_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project_name, Environment = var.environment }
}

/**
 * Single-node ElastiCache Redis — hot cache for real-time contradiction
 * checks (System Architecture, P95 < 1s requirement). No replication
 * group / cluster mode at staging scale; revisit if the performance
 * target isn't met under real design-partner traffic.
 */

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-redis-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id         = "${var.project_name}-${var.environment}-redis"
  engine             = "redis"
  engine_version     = "7.1"
  node_type          = var.redis_node_type
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  tags = { Name = "${var.project_name}-${var.environment}-redis" }
}

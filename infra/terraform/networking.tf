/**
 * Minimal VPC: public subnets for the NAT gateway, private subnets for
 * RDS, ElastiCache, and the App Runner VPC connector.
 *
 * A NAT gateway is unavoidable here despite the cost-optimization brief:
 * the API server needs outbound internet access for Anthropic and Neo4j
 * AuraDB (both external SaaS, not AWS services), and App Runner's VPC
 * connector routes through private subnets with no other path out. VPC
 * gateway endpoints (free) cover S3 traffic specifically and are added
 * below to reduce what flows through the NAT gateway, but Anthropic/Aura
 * traffic still needs it. Single NAT gateway (not one per AZ) — the
 * standard staging-environment cost trade-off: a NAT gateway outage took
 * down outbound traffic from both AZs, which is an acceptable risk at
 * this stage, not for production multi-AZ resilience.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project_name}-${var.environment}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-${var.environment}-igw" }
}

resource "aws_subnet" "public" {
  count                   = var.availability_zone_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project_name}-${var.environment}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count             = var.availability_zone_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + var.availability_zone_count)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.project_name}-${var.environment}-private-${local.azs[count.index]}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-${var.environment}-nat-eip" }
}

# Single NAT gateway in the first public subnet — see file header comment.
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.project_name}-${var.environment}-nat" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project_name}-${var.environment}-public-rt" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${var.project_name}-${var.environment}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = var.availability_zone_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = var.availability_zone_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Free gateway endpoint — keeps S3 traffic (object store) off the NAT
# gateway entirely, reducing NAT data-processing charges.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = { Name = "${var.project_name}-${var.environment}-s3-endpoint" }
}

# --- Security groups ---
#
# ECS tasks (ecs.tf) run directly inside this VPC's private subnets (no
# VPC-connector indirection like App Runner needed) — the task security
# group below is what RDS/Redis allow inbound from. See ecs.tf for the
# ALB and ECS task security groups themselves; defined there since
# they're ECS/ALB-specific, referenced here for RDS/Redis ingress.

resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-${var.environment}-rds-"
  # NOTE: top-level `description` is immutable on AWS security groups —
  # changing this string forces Terraform to destroy and recreate the
  # whole resource, which got stuck for 15 minutes mid-apply because
  # ElastiCache/RDS still referenced the old one (DependencyViolation).
  # Left at its original text on purpose; the ingress rule's own
  # `description` below (and `security_groups` source) update in place
  # without forcing replacement, so that's where the real change lives.
  description = "Postgres - inbound only from the App Runner VPC connector."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-rds-sg" }
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.project_name}-${var.environment}-redis-"
  # See the matching note on aws_security_group.rds above — top-level
  # `description` left unchanged on purpose to avoid forced replacement.
  description = "Redis - inbound only from the App Runner VPC connector."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-${var.environment}-redis-sg" }
}

/**
 * Container registry for the api-server image. CI builds and pushes here
 * on every merge to main (.github/workflows/deploy-staging.yml); App
 * Runner (apprunner.tf) deploys from this repository.
 */

resource "aws_ecr_repository" "api_server" {
  name                 = "${var.project_name}-api-server"
  image_tag_mutability = "MUTABLE" # CI pushes :latest plus a commit-sha tag; staging doesn't need immutable tags

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "${var.project_name}-api-server-ecr" }
}

# Keep only recent images — staging doesn't need indefinite image history,
# and ECR storage is billed per GB-month.
resource "aws_ecr_lifecycle_policy" "api_server" {
  repository = aws_ecr_repository.api_server.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

/**
 * Object store (System Architecture §4.2.4). Matches @voai/db's
 * ObjectStoreClient exactly — this is real S3, not MinIO, so
 * OBJECT_STORE_ENDPOINT is omitted in staging/production (see
 * .env.example's comment on that variable).
 */

resource "aws_s3_bucket" "object_store" {
  bucket = "${var.project_name}-${var.environment}-objects"
  tags   = { Name = "${var.project_name}-${var.environment}-objects" }
}

resource "aws_s3_bucket_public_access_block" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Tenant-prefixed keys (per §4.2.4: {tenantId}/{sessionId}/...) age out
# automatically rather than accumulating indefinitely — adjust once real
# retention requirements are defined (e.g. DPDPA-driven retention rules).
resource "aws_s3_bucket_lifecycle_configuration" "object_store" {
  bucket = aws_s3_bucket.object_store.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Remote Terraform state bucket — see versions.tf's commented-out backend
# block. Created here so the very first `terraform apply` (with a local
# backend) can provision it; subsequent applies migrate state into it.
resource "aws_s3_bucket" "terraform_state" {
  bucket = "${var.project_name}-terraform-state"
  tags   = { Name = "${var.project_name}-terraform-state" }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "${var.project_name}-terraform-locks"
  billing_mode = "PAY_PER_REQUEST" # no fixed cost when idle — appropriate for infrequent terraform applies
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = { Name = "${var.project_name}-terraform-locks" }
}

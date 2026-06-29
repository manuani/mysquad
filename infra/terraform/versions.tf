terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state backend — populate once a state bucket exists (chicken-
  # and-egg: the first apply with this block commented out creates the
  # bucket in s3.tf's `voai_terraform_state` resource, then uncomment and
  # `terraform init -migrate-state` to move state into it). Left local
  # for the very first apply.
  # backend "s3" {
  #   bucket         = "voai-terraform-state"
  #   key            = "staging/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "voai-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "voai-platform"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

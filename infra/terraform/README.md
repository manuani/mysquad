# Terraform — staging environment

Sprint 1.1.3 (Staging deployment pipeline). Cloud provider and region are
decided (ADR 012: AWS, `ap-south-1`) — this is the IaC, not yet applied
anywhere. Nothing here has been run against a real AWS account.

## What this provisions

| Resource                            | File            | Purpose                                                         |
| ----------------------------------- | --------------- | --------------------------------------------------------------- |
| VPC, subnets, NAT, security groups  | `networking.tf` | Network boundary for everything below                           |
| RDS Postgres 16                     | `rds.tf`        | Structured + vector store (pgvector)                            |
| ElastiCache Redis                   | `redis.tf`      | Hot cache                                                       |
| S3 bucket (+ lifecycle, encryption) | `s3.tf`         | Object store; also a separate bucket for Terraform remote state |
| ECR repository                      | `ecr.tf`        | Container image CI pushes to                                    |
| Secrets Manager                     | `secrets.tf`    | Every credential the app needs at runtime                       |
| App Runner service + VPC connector  | `apprunner.tf`  | The API server pool (§3.7)                                      |

Not provisioned here: **Neo4j** (AuraDB is its own managed SaaS,
independent of this cloud choice per ADR 012 — provision separately at
https://console.neo4j.io and pass its connection details as variables).

## Cost shape (rough, `ap-south-1`, as of this writing — verify current pricing before relying on this)

This is a staging environment sized for Strategic Vision §8.1/§8.2's
Design Partner phase (10-15 founders), not production load:

- RDS `db.t4g.micro`, single-AZ: ~$13-15/mo + storage
- ElastiCache `cache.t4g.micro`, single node: ~$10-12/mo
- NAT gateway: ~$32/mo + data processing — the single largest fixed cost
  here, and not avoidable (see `networking.tf`'s header comment for why)
- App Runner: pay-per-use (vCPU/memory-seconds while running + per-request) — this is the main lever if traffic is low; idle cost is close to zero compared to an always-on Fargate task
- S3, ECR, Secrets Manager: a few dollars/month at this scale

Total fixed cost (excluding App Runner's usage-based pricing) is
dominated by the NAT gateway and the two single-node databases — roughly
$55-60/mo before any real traffic. The NAT gateway is the one cost that
doesn't scale down with low usage; if that becomes a real concern,
revisit whether a NAT instance (cheaper, more ops burden — exactly the
tradeoff ADR 012 weighed against) makes sense once there's enough
traffic history to judge.

## First-time setup

This has never been applied. Before running `terraform apply` for the
first time:

1. **AWS credentials.** Configure a profile or environment variables with
   permissions to create VPC, RDS, ElastiCache, S3, ECR, IAM, App Runner,
   and Secrets Manager resources. Not provided in this repository — this
   is the one thing only a human with an AWS account can supply.
2. **Neo4j AuraDB instance.** Provision one at https://console.neo4j.io
   (free tier is fine for staging) and note its connection URI/password.
3. **Set the required variables** — none have defaults, by design (they're
   all secrets):
   ```bash
   export TF_VAR_db_master_password="..."       # generate, e.g. openssl rand -base64 24
   export TF_VAR_db_app_role_password="..."     # different from the master password
   export TF_VAR_neo4j_aura_uri="neo4j+s://..."
   export TF_VAR_neo4j_aura_password="..."
   export TF_VAR_anthropic_api_key="sk-ant-..."
   ```
4. **First apply** (local state — the remote backend in `versions.tf` is
   commented out because the state bucket doesn't exist until this first
   apply creates it):
   ```bash
   cd infra/terraform
   terraform init
   terraform plan
   terraform apply
   ```
5. **Build and push the first image** — App Runner's `image_identifier`
   references a tag that must already exist in ECR before the service
   can be created. `apps/api-server/Dockerfile` exists and has been
   built and run locally against the Docker Compose stack (healthy,
   all 11 modules registered) — not yet pushed to a real ECR. Either let
   CI do this on the next push to `main`
   (`.github/workflows/deploy-staging.yml`, gated on the
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` repository secrets — see
   that workflow's header comment), or push manually once:
   ```bash
   aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-south-1.amazonaws.com
   docker build -t <ecr_repository_url>:latest -f apps/api-server/Dockerfile .
   docker push <ecr_repository_url>:latest
   ```
6. **Create the application-level Postgres role.** Terraform provisions
   the RDS _instance_; it does not run SQL inside the database. Per ADR
   010's two-role pattern, connect with the master credentials once and
   run the equivalent of `infra/docker/init/postgres/002_app_role.sql`
   against this RDS instance (adjusted for the actual database name and
   `TF_VAR_db_app_role_password`), then run migrations:
   ```bash
   psql "$(terraform output -raw rds_endpoint)..." -f infra/docker/init/postgres/002_app_role.sql
   MIGRATIONS_DATABASE_URL=postgres://voai_admin:...@<rds_endpoint>:5432/voai_staging pnpm run db:migrate
   ```
7. **Migrate state to the S3 backend** (optional but recommended once the
   bucket exists from step 4): uncomment the `backend "s3"` block in
   `versions.tf`, then `terraform init -migrate-state`.
8. **Add GitHub repository secrets** so `.github/workflows/deploy-staging.yml`
   can deploy on every push to `main` going forward: `AWS_ACCESS_KEY_ID`
   and `AWS_SECRET_ACCESS_KEY` for an IAM user scoped to ECR push +
   `apprunner:DescribeService`/`ListServices` (narrower than the
   Terraform-applying credentials from step 1 — this one only needs to
   push images and check deploy status, not create infrastructure).
   Until these secrets exist, the workflow runs but skips every step
   after the secrets check, by design.

## What's NOT done yet

- No custom domain / TLS beyond App Runner's default `*.awsapprunner.com`
  URL — fine for staging, revisit for any public launch.
- No monitoring/alerting beyond App Runner's built-in health check.
- No WAF or rate limiting at the edge (System Architecture §3.1's Edge
  Gateway is still infra-level and unbuilt, per `docs/adr/009-rename-api-gateway.md`).
- This has never been run against a real AWS account. Review every
  resource here as a careful human before the first `terraform apply` —
  this is real infrastructure that costs real money once it exists.

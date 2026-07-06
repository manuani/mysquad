# Copy to terraform.tfvars (gitignored) and fill in real values, or set
# the equivalent TF_VAR_* environment variables instead (preferred for
# secrets — see README.md "First-time setup"). Every sensitive variable
# here has no default in variables.tf on purpose; Terraform will refuse
# to plan/apply without a real value supplied one way or the other.

aws_region   = "ap-south-1"
environment  = "staging"
project_name = "voai"

# --- Secrets — do not put real values in a file you might commit.       ---
# --- Prefer `export TF_VAR_<name>=...` in your shell instead.            ---

# db_master_password    = ""
# db_app_role_password  = ""
# neo4j_aura_uri         = ""
# neo4j_aura_password    = ""
# anthropic_api_key      = ""

# --- Alerting (alerts.tf) -------------------------------------------------- ---
# alert_email        = "smdharan@gmail.com"    # receives SNS email on alarm (default)
# pagerduty_endpoint = ""                      # PagerDuty Events API v2 HTTPS URL

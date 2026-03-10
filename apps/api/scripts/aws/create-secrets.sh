#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   AWS_REGION=sa-east-1 \
#   ./scripts/aws/create-secrets.sh \
#     GOOGLE_JSON_FILE=/path/creds.json \
#     SMTP_PASS_VALUE='xxxx' \
#     SECRET_PREFIX='enviar-guias/prod'
#
# Creates/updates Secrets Manager secrets:
#  - ${SECRET_PREFIX}/GOOGLE_APPLICATION_CREDENTIALS_JSON
#  - ${SECRET_PREFIX}/SMTP_PASS
#  - ${SECRET_PREFIX}/RUN_TOKEN (optional; set RUN_TOKEN_VALUE)

: "${AWS_REGION:?AWS_REGION is required}"
AWS="${AWS:-aws}"

SECRET_PREFIX="${SECRET_PREFIX:-enviar-guias/prod}"
GOOGLE_JSON_FILE="${GOOGLE_JSON_FILE:-}"
SMTP_PASS_VALUE="${SMTP_PASS_VALUE:-}"
RUN_TOKEN_VALUE="${RUN_TOKEN_VALUE:-}"

create_or_update_secret() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "Skipping empty secret $name"
    return
  fi
  set +e
  $AWS secretsmanager describe-secret --secret-id "$name" --region "$AWS_REGION" >/dev/null 2>&1
  exists=$?
  set -e
  if [ "$exists" -ne 0 ]; then
    echo "Creating secret $name"
    $AWS secretsmanager create-secret --name "$name" --secret-string "$value" --region "$AWS_REGION" >/dev/null
  else
    echo "Updating secret $name"
    $AWS secretsmanager put-secret-value --secret-id "$name" --secret-string "$value" --region "$AWS_REGION" >/dev/null
  fi
}

if [ -n "$GOOGLE_JSON_FILE" ]; then
  if [ ! -f "$GOOGLE_JSON_FILE" ]; then
    echo "File not found: $GOOGLE_JSON_FILE" >&2
    exit 1
  fi
  GOOGLE_JSON_VALUE="$(cat "$GOOGLE_JSON_FILE")"
  create_or_update_secret "${SECRET_PREFIX}/GOOGLE_APPLICATION_CREDENTIALS_JSON" "$GOOGLE_JSON_VALUE"
fi

create_or_update_secret "${SECRET_PREFIX}/SMTP_PASS" "$SMTP_PASS_VALUE"

if [ -n "$RUN_TOKEN_VALUE" ]; then
  create_or_update_secret "${SECRET_PREFIX}/RUN_TOKEN" "$RUN_TOKEN_VALUE"
fi

echo "Done."



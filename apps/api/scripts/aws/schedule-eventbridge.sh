#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   AWS_REGION=sa-east-1 \
#   SERVICE_URL="https://xxxx.sa-east-1.awsapprunner.com" \
#   RUN_TOKEN="secret-token" \
#   SCHEDULE="cron(0 11 1 * ? *)" \
#   NAME_PREFIX="enviar-guias" \
#   ./scripts/aws/schedule-eventbridge.sh
#
# Creates an EventBridge Connection (API_KEY using header 'x-run-token'),
# an API Destination POSTing to $SERVICE_URL/run, a scheduler rule and target.

: "${AWS_REGION:?AWS_REGION is required}"
: "${SERVICE_URL:?SERVICE_URL is required}"
: "${RUN_TOKEN:?RUN_TOKEN is required}"
: "${SCHEDULE:?SCHEDULE is required}"

NAME_PREFIX="${NAME_PREFIX:-enviar-guias}"
AWS="${AWS:-aws}"

CONN_NAME="${NAME_PREFIX}-conn"
DEST_NAME="${NAME_PREFIX}-dest"
RULE_NAME="${NAME_PREFIX}-schedule"
ROLE_NAME="${NAME_PREFIX}-events-role"

echo "Creating/Updating Connection: $CONN_NAME"
set +e
$AWS events describe-connection --name "$CONN_NAME" --region "$AWS_REGION" >/dev/null 2>&1
exists=$?
set -e
if [ "$exists" -ne 0 ]; then
  $AWS events create-connection \
    --name "$CONN_NAME" \
    --authorization-type API_KEY \
    --auth-parameters ApiKeyName='x-run-token',ApiKeyValue="$RUN_TOKEN" \
    --region "$AWS_REGION" >/dev/null
else
  $AWS events update-connection \
    --name "$CONN_NAME" \
    --authorization-type API_KEY \
    --auth-parameters ApiKeyName='x-run-token',ApiKeyValue="$RUN_TOKEN" \
    --region "$AWS_REGION" >/dev/null
fi

CONN_ARN="$($AWS events describe-connection --name "$CONN_NAME" --region "$AWS_REGION" --query 'ConnectionArn' --output text)"
echo "Connection ARN: $CONN_ARN"

echo "Creating/Updating API Destination: $DEST_NAME"
ENDPOINT="${SERVICE_URL%/}/run"
set +e
$AWS events describe-api-destination --name "$DEST_NAME" --region "$AWS_REGION" >/dev/null 2>&1
exists=$?
set -e
if [ "$exists" -ne 0 ]; then
  $AWS events create-api-destination \
    --name "$DEST_NAME" \
    --connection-arn "$CONN_ARN" \
    --invocation-endpoint "$ENDPOINT" \
    --http-method POST \
    --invocation-rate-limit-per-second 1 \
    --region "$AWS_REGION" >/dev/null
else
  $AWS events update-api-destination \
    --name "$DEST_NAME" \
    --connection-arn "$CONN_ARN" \
    --invocation-endpoint "$ENDPOINT" \
    --http-method POST \
    --invocation-rate-limit-per-second 1 \
    --region "$AWS_REGION" >/dev/null
fi

DEST_ARN="$($AWS events describe-api-destination --name "$DEST_NAME" --region "$AWS_REGION" --query 'ApiDestinationArn' --output text)"
echo "API Destination ARN: $DEST_ARN"

echo "Creating/Updating IAM role for EventBridge to invoke API Destination: $ROLE_NAME"
set +e
$AWS iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1
role_exists=$?
set -e
if [ "$role_exists" -ne 0 ]; then
  $AWS iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "events.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
fi

$AWS iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "${ROLE_NAME}-policy" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [
        \"events:InvokeApiDestination\"
      ],
      \"Resource\": \"${DEST_ARN}\"
    }]
  }" >/dev/null

ROLE_ARN="$($AWS iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"
echo "Role ARN: $ROLE_ARN"

echo "Creating/Updating schedule rule: $RULE_NAME ($SCHEDULE)"
set +e
$AWS events describe-rule --name "$RULE_NAME" --region "$AWS_REGION" >/dev/null 2>&1
rule_exists=$?
set -e
if [ "$rule_exists" -ne 0 ]; then
  $AWS events put-rule \
    --name "$RULE_NAME" \
    --schedule-expression "$SCHEDULE" \
    --region "$AWS_REGION" >/dev/null
else
  $AWS events put-rule \
    --name "$RULE_NAME" \
    --schedule-expression "$SCHEDULE" \
    --region "$AWS_REGION" >/dev/null
fi

echo "Attach target to rule"
$AWS events put-targets \
  --rule "$RULE_NAME" \
  --targets "Id=${NAME_PREFIX}-target,Arn=${DEST_ARN},RoleArn=${ROLE_ARN}" \
  --region "$AWS_REGION" >/dev/null

echo "Done."



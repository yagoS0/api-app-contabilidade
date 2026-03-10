#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   AWS_REGION=sa-east-1 AWS_ACCOUNT_ID=123456789012 ECR_REPO=enviar-guias ./scripts/aws/create-ecr.sh
#
# Creates the ECR repository if it doesn't exist and prints the IMAGE_URI to stdout.

: "${AWS_REGION:?AWS_REGION is required}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
: "${ECR_REPO:?ECR_REPO is required}"

AWS="${AWS:-aws}"

if ! $AWS --version >/dev/null 2>&1; then
  echo "aws cli not found. Install and configure it first." >&2
  exit 1
fi

set +e
$AWS ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1
exists=$?
set -e

if [ "$exists" -ne 0 ]; then
  echo "Creating ECR repository: $ECR_REPO in $AWS_REGION"
  $AWS ecr create-repository \
    --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --region "$AWS_REGION" \
    >/dev/null
else
  echo "ECR repository already exists: $ECR_REPO"
fi

IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
echo "$IMAGE_URI"



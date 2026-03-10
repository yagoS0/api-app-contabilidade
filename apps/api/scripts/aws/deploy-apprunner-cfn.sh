#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   STACK=enviar-guias-send-only \
#   AWS_REGION=sa-east-1 \
#   IMAGE_URI=123456789012.dkr.ecr.sa-east-1.amazonaws.com/enviar-guias:v0.1.0 \
#   DRIVE_FOLDER_ID_CLIENTES=xxx SHEET_ID=yyy RUN_TOKEN=zzz \
#   GOOGLE_JSON_ARN=arn:aws:secretsmanager:...:secret:enviar-guias/prod/GOOGLE_APPLICATION_CREDENTIALS_JSON-abc \
#   SMTP_PASS_ARN=arn:aws:secretsmanager:...:secret:enviar-guias/prod/SMTP_PASS-abc \
#   ./scripts/aws/deploy-apprunner-cfn.sh
#
# Deploys/updates the App Runner service using CloudFormation.

: "${STACK:?STACK is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${IMAGE_URI:?IMAGE_URI is required}"
: "${DRIVE_FOLDER_ID_CLIENTES:?DRIVE_FOLDER_ID_CLIENTES is required}"
: "${SHEET_ID:?SHEET_ID is required}"
: "${GOOGLE_JSON_ARN:?GOOGLE_JSON_ARN is required}"

RUN_TOKEN="${RUN_TOKEN:-}"
SMTP_PASS_ARN="${SMTP_PASS_ARN:-}"
TZ="${TZ:-America/Sao_Paulo}"
LOG_LEVEL="${LOG_LEVEL:-info}"
CPU="${CPU:-1 vCPU}"
MEMORY="${MEMORY:-2 GB}"
PORT="${PORT:-3000}"
SERVICE_NAME="${SERVICE_NAME:-enviar-guias-send-only}"

AWS="${AWS:-aws}"

PARAMS=(
  ParameterKey=ServiceName,ParameterValue="$SERVICE_NAME"
  ParameterKey=ImageUri,ParameterValue="$IMAGE_URI"
  ParameterKey=Cpu,ParameterValue="$CPU"
  ParameterKey=Memory,ParameterValue="$MEMORY"
  ParameterKey=Port,ParameterValue="$PORT"
  ParameterKey=TZ,ParameterValue="$TZ"
  ParameterKey=LOG_LEVEL,ParameterValue="$LOG_LEVEL"
  ParameterKey=DRIVE_FOLDER_ID_CLIENTES,ParameterValue="$DRIVE_FOLDER_ID_CLIENTES"
  ParameterKey=SHEET_ID,ParameterValue="$SHEET_ID"
  ParameterKey=RUN_TOKEN,ParameterValue="$RUN_TOKEN"
  ParameterKey=GOOGLE_APPLICATION_CREDENTIALS_JSON_ARN,ParameterValue="$GOOGLE_JSON_ARN"
  ParameterKey=SMTP_PASS_ARN,ParameterValue="$SMTP_PASS_ARN"
)

$AWS cloudformation deploy \
  --template-file infra/apprunner-send-only.yaml \
  --stack-name "$STACK" \
  --parameter-overrides "${PARAMS[@]}" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION"

$AWS cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs" --output table



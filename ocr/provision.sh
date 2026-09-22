#!/usr/bin/env bash
# One-time provisioning for the OCR pipeline in ap-east-2. Idempotent: every
# step is a create-or-leave, so re-running after a partial failure is safe.
#
#   ./ocr/provision.sh phase1   # bucket, ECR repo, roles, policies, env var
#   (push, or run "Deploy OCR Lambda" from the Actions tab, so an image exists)
#   ./ocr/provision.sh phase2   # the function, the S3 trigger, the hourly sweep
#
# Two phases because a container-image Lambda cannot be created without an
# image, and the image is built by CI (no Docker on the dev machine; arm64
# cross-build is slow anyway). The deploy workflow only ever *updates* the
# function — deploy-backend.yml's rule — so creation lives here.
#
# Needs a live `aws login` session. Read what each step does before running;
# the IAM edits are additive (new inline policies, nothing replaced).
set -euo pipefail

REGION=ap-east-2
BUCKET=tish-ocr-scans
REPO=tish-ocr
FUNCTION=tish-ocr
OCR_ROLE=tish-ocr-lambda
API_FUNCTION=operation-strix
DEPLOY_ROLE=github-lambda-deploy
SWEEP_RULE=tish-ocr-sweep
RETENTION_SECONDS=3600

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export AWS_DEFAULT_REGION=$REGION

phase1() {
  echo "== S3 bucket $BUCKET"
  if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration LocationConstraint=$REGION
  fi
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  # The web build (Amplify) PUTs straight to the presigned URL from the
  # browser, so the bucket must answer its preflight. Native builds do not
  # preflight and are unaffected.
  aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
    "CORSRules": [{
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["PUT", "GET"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }]
  }'
  # **One day is the floor for a lifecycle expiration** — S3 does not take
  # hours. The hourly sweep (phase2) is what actually enforces the one-hour
  # retention; this rule is the backstop for a sweep that stopped running.
  aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-everything-after-a-day",
      "Status": "Enabled",
      "Filter": {},
      "Expiration": {"Days": 1},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}
    }]
  }'

  echo "== ECR repository $REPO"
  aws ecr describe-repositories --repository-names "$REPO" >/dev/null 2>&1 || \
    aws ecr create-repository --repository-name "$REPO" \
      --image-scanning-configuration scanOnPush=true >/dev/null
  aws ecr put-lifecycle-policy --repository-name "$REPO" --lifecycle-policy-text '{
    "rules": [{
      "rulePriority": 1,
      "description": "keep the last five images",
      "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 5},
      "action": {"type": "expire"}
    }]
  }' >/dev/null

  echo "== execution role $OCR_ROLE"
  if ! aws iam get-role --role-name "$OCR_ROLE" >/dev/null 2>&1; then
    aws iam create-role --role-name "$OCR_ROLE" --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
    }' >/dev/null
    aws iam attach-role-policy --role-name "$OCR_ROLE" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  fi
  aws iam put-role-policy --role-name "$OCR_ROLE" --policy-name tish-ocr-bucket --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {\"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"], \"Resource\": \"arn:aws:s3:::$BUCKET/*\"},
      {\"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\"], \"Resource\": \"arn:aws:s3:::$BUCKET\"}
    ]
  }"

  echo "== presign grant on the API Lambda's role"
  API_ROLE=$(aws lambda get-function-configuration --function-name "$API_FUNCTION" --query Role --output text)
  API_ROLE=${API_ROLE##*/}
  # A presigned URL can do exactly what its signer can. PUT under uploads/,
  # GET under results/, nothing else — the API Lambda itself never calls S3.
  aws iam put-role-policy --role-name "$API_ROLE" --policy-name tish-ocr-presign --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {\"Effect\": \"Allow\", \"Action\": \"s3:PutObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/uploads/*\"},
      {\"Effect\": \"Allow\", \"Action\": \"s3:GetObject\", \"Resource\": \"arn:aws:s3:::$BUCKET/results/*\"}
    ]
  }"

  echo "== OCR_BUCKET on $API_FUNCTION (merged into the existing environment)"
  # update-function-configuration --environment REPLACES the map, so the
  # existing variables (DB credentials among them) have to be read and
  # re-sent with the new key added.
  # Node rather than Python for the merge: it is what every workflow in this
  # repo already runs on, and `python` on the dev machine is a Store stub.
  MERGED=$(aws lambda get-function-configuration --function-name "$API_FUNCTION" \
             --query 'Environment.Variables' --output json \
           | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s||'{}')||{};v.OCR_BUCKET='$BUCKET';process.stdout.write(JSON.stringify({Variables:v}))})")
  aws lambda update-function-configuration --function-name "$API_FUNCTION" \
    --environment "$MERGED" >/dev/null
  aws lambda wait function-updated --function-name "$API_FUNCTION"

  echo "== deploy role: ECR push + update-function-code on $FUNCTION"
  # A *new* inline policy rather than an edit of github-lambda-deployPolicy,
  # so this is additive and the audited list in DEPLOY.md stays as printed.
  aws iam put-role-policy --role-name "$DEPLOY_ROLE" --policy-name tish-ocr-deploy --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {\"Effect\": \"Allow\", \"Action\": \"ecr:GetAuthorizationToken\", \"Resource\": \"*\"},
      {\"Effect\": \"Allow\", \"Action\": [
        \"ecr:BatchCheckLayerAvailability\", \"ecr:BatchGetImage\", \"ecr:GetDownloadUrlForLayer\",
        \"ecr:InitiateLayerUpload\", \"ecr:UploadLayerPart\", \"ecr:CompleteLayerUpload\", \"ecr:PutImage\"
      ], \"Resource\": \"arn:aws:ecr:$REGION:$ACCOUNT:repository/$REPO\"},
      {\"Effect\": \"Allow\", \"Action\": [\"lambda:UpdateFunctionCode\", \"lambda:GetFunction\", \"lambda:GetFunctionConfiguration\"],
       \"Resource\": \"arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION\"}
    ]
  }"
  echo "phase1 done. Now push (or run 'Deploy OCR Lambda' by hand) so an image exists, then: $0 phase2"
}

phase2() {
  IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:latest"
  aws ecr describe-images --repository-name "$REPO" --image-ids imageTag=latest >/dev/null \
    || { echo "no :latest image in $REPO yet — run the Deploy OCR Lambda workflow first"; exit 1; }

  echo "== function $FUNCTION"
  if ! aws lambda get-function --function-name "$FUNCTION" >/dev/null 2>&1; then
    aws lambda create-function --function-name "$FUNCTION" \
      --package-type Image --code ImageUri="$IMAGE" \
      --role "arn:aws:iam::$ACCOUNT:role/$OCR_ROLE" \
      --architectures arm64 --memory-size 2048 --timeout 90 \
      --environment "Variables={OCR_BUCKET=$BUCKET,RETENTION_SECONDS=$RETENTION_SECONDS}" \
      --description "Reads photographed lab reports; see ocr/README.md" >/dev/null
    aws lambda wait function-active --function-name "$FUNCTION"
  fi
  FN_ARN=$(aws lambda get-function-configuration --function-name "$FUNCTION" --query FunctionArn --output text)

  echo "== S3 trigger on uploads/"
  aws lambda add-permission --function-name "$FUNCTION" --statement-id s3-uploads \
    --action lambda:InvokeFunction --principal s3.amazonaws.com \
    --source-arn "arn:aws:s3:::$BUCKET" --source-account "$ACCOUNT" >/dev/null 2>&1 || true
  aws s3api put-bucket-notification-configuration --bucket "$BUCKET" --notification-configuration "{
    \"LambdaFunctionConfigurations\": [{
      \"Id\": \"ocr-on-upload\",
      \"LambdaFunctionArn\": \"$FN_ARN\",
      \"Events\": [\"s3:ObjectCreated:*\"],
      \"Filter\": {\"Key\": {\"FilterRules\": [{\"Name\": \"prefix\", \"Value\": \"uploads/\"}]}}
    }]
  }"

  echo "== hourly sweep $SWEEP_RULE"
  aws events put-rule --name "$SWEEP_RULE" --schedule-expression 'rate(1 hour)' \
    --description "Deletes OCR scans and results older than $RETENTION_SECONDS s" >/dev/null
  aws lambda add-permission --function-name "$FUNCTION" --statement-id eventbridge-sweep \
    --action lambda:InvokeFunction --principal events.amazonaws.com \
    --source-arn "arn:aws:events:$REGION:$ACCOUNT:rule/$SWEEP_RULE" >/dev/null 2>&1 || true
  aws events put-targets --rule "$SWEEP_RULE" \
    --targets "Id=ocr,Arn=$FN_ARN,Input='{\"command\":\"sweep\"}'" >/dev/null
  echo "phase2 done."
}

case "${1:-}" in
  phase1) phase1 ;;
  phase2) phase2 ;;
  *) echo "usage: $0 phase1|phase2"; exit 2 ;;
esac

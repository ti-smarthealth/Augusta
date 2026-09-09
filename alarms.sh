#!/bin/bash
# CloudWatch alarms for the Tish stack.
#
# **Every alarm here is named `tish-*` on purpose** — the dashboard's Health
# page lists alarms by that prefix, so an alarm created outside this script
# still shows up as long as it follows the convention.
#
# All of them publish to `tish-alarms`, which reaches a phone by SMS since
# 2026-09-08. Before that the topic had no subscribers at all and the dashboard's
# Health page was the only place a firing alarm was visible.
#
# **Two things about that channel are worth knowing before you add an alarm
# here**, because both make a new alarm cost more than it looks:
#
#   - Every alarm below sets `--ok-actions` as well as `--alarm-actions`, so a
#     single incident sends **two** messages — one firing, one clearing.
#   - The account's SNS spend limit is still `$1`/month (`MIGRATION.md` B1), which
#     at Australian SMS rates is roughly twenty messages. So the SMS budget is
#     about **ten incidents a month**, after which SNS stops delivering without
#     raising anything — a silent cap on the channel whose job is to break
#     silence.
#
# **`admin@ti-smarthealth.com` is subscribed by email as well** (2026-09-09), and
# that half has no cap, no sandbox and no per-message cost. Treat SMS as the
# nudge and email as the record: when the spend limit is reached the texts stop
# and the mail keeps arriving, so an alarm is never lost outright — but the
# *notification you actually wake up to* can be, which is why B1 still matters.
set -euo pipefail

R=ap-east-2
TOPIC=$(aws sns create-topic --name tish-alarms --region $R --query 'TopicArn' --output text)
echo "topic: $TOPIC"

# errors <function> <threshold> <period> <description>
errors() {
  aws cloudwatch put-metric-alarm \
    --alarm-name "tish-${1#tish-}-errors" \
    --alarm-description "$4" \
    --namespace AWS/Lambda --metric-name Errors \
    --dimensions Name=FunctionName,Value="$1" \
    --statistic Sum --period "$3" --evaluation-periods 1 \
    --threshold "$2" --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "$TOPIC" --ok-actions "$TOPIC" \
    --region $R
  echo "  alarm: tish-${1#tish-}-errors"
}

# **The safety-critical path first.** Under D-6 a snooze defers caregiver
# escalation and a confirm cancels it; if this job is failing, a caregiver is
# not being told about a missed dose. One error is worth knowing about.
errors tish-escalate-dispatch 1 300 "Escalation dispatcher is erroring - caregivers may not be alerted to missed doses"
errors tish-escalate-db       1 300 "Escalation database half is erroring - claims or outbox writes are failing"

# The app's own API. Higher threshold and a wider window: a single 5xx here is
# usually one bad request, and an alarm that cries wolf gets muted.
errors operation-strix 5 300 "App API erroring repeatedly - reminders, doses or auth may be affected"

errors tish-telemetry-rollup 1 3600 "Nightly telemetry rollup failed - the dashboard's app-open figures will go stale"

# **The failure that looks like silence.** The escalation sweep runs every
# minute, so no invocations for fifteen means the schedule itself has stopped —
# which produces no errors at all and is invisible without this. Missing data is
# breaching precisely because "no data" is the symptom.
aws cloudwatch put-metric-alarm \
  --alarm-name "tish-escalation-schedule-stalled" \
  --alarm-description "Escalation sweep has not run for 15 minutes - the schedule itself has stopped" \
  --namespace AWS/Lambda --metric-name Invocations \
  --dimensions Name=FunctionName,Value=tish-escalate-dispatch \
  --statistic Sum --period 900 --evaluation-periods 1 \
  --threshold 1 --comparison-operator LessThanThreshold \
  --treat-missing-data breaching \
  --alarm-actions "$TOPIC" --ok-actions "$TOPIC" \
  --region $R
echo "  alarm: tish-escalation-schedule-stalled"

# Firehose dropping records means telemetry is being lost with a 200 upstream.
aws cloudwatch put-metric-alarm \
  --alarm-name "tish-telemetry-firehose-failures" \
  --alarm-description "Firehose failed to deliver telemetry records to S3" \
  --namespace AWS/Firehose --metric-name DeliveryToS3.Success \
  --dimensions Name=DeliveryStreamName,Value=tish-telemetry \
  --statistic Average --period 3600 --evaluation-periods 1 \
  --threshold 1 --comparison-operator LessThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC" --ok-actions "$TOPIC" \
  --region $R
echo "  alarm: tish-telemetry-firehose-failures"

# 20 GB total, and the dose table grows ~3,000 rows per user per year. Running
# out is a hard stop for every write in the product.
aws cloudwatch put-metric-alarm \
  --alarm-name "tish-rds-storage-low" \
  --alarm-description "season1 has under 4 GB free - writes will fail when it runs out" \
  --namespace AWS/RDS --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=season1 \
  --statistic Average --period 300 --evaluation-periods 2 \
  --threshold 4294967296 --comparison-operator LessThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC" --ok-actions "$TOPIC" \
  --region $R
echo "  alarm: tish-rds-storage-low"

echo "ALARMS_DONE"

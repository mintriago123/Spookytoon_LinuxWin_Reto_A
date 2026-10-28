#!/usr/bin/env bash
set -euo pipefail
AWS_REGION=${AWS_REGION:-us-east-2}
INSTANCE_ID=${INSTANCE_ID:-i-010f44e5ec891fc73}
[[ "$AWS_REGION" == us-east-2 ]] || { echo 'La SCP solo permite us-east-2' >&2; exit 1; }
actions=()
if [[ -n "${SNS_TOPIC_ARN:-}" ]]; then
  [[ "$SNS_TOPIC_ARN" =~ ^arn:aws:sns:us-east-2:[0-9]{12}:.+$ ]] || { echo 'SNS_TOPIC_ARN debe pertenecer a us-east-2' >&2; exit 1; }
  actions=(--alarm-actions "$SNS_TOPIC_ARN" --ok-actions "$SNS_TOPIC_ARN")
fi
LOG_GROUP=${LOG_GROUP:-/spookython/backend}
# Preparar el grupo antes de los filtros; no depender del primer envío del agente.
existing=$(aws logs describe-log-groups --region "$AWS_REGION" --log-group-name-prefix "$LOG_GROUP" \
  --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" --output text)
if [[ -z "$existing" ]]; then aws logs create-log-group --region "$AWS_REGION" --log-group-name "$LOG_GROUP"; fi
aws logs put-retention-policy --region "$AWS_REGION" --log-group-name "$LOG_GROUP" --retention-in-days 14
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name spookython-ec2-cpu-high --namespace AWS/EC2 --metric-name CPUUtilization \
  --dimensions "Name=InstanceId,Value=$INSTANCE_ID" --statistic Average --period 300 \
  --evaluation-periods 2 --threshold 80 --comparison-operator GreaterThanThreshold \
  --treat-missing-data missing "${actions[@]}"
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name spookython-ec2-status-failed --namespace AWS/EC2 --metric-name StatusCheckFailed \
  --dimensions "Name=InstanceId,Value=$INSTANCE_ID" --statistic Maximum --period 60 \
  --evaluation-periods 2 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data missing "${actions[@]}"
if [[ -z "${SNS_TOPIC_ARN:-}" ]]; then echo 'Alarmas creadas sin destinatario SNS; configurar SNS_TOPIC_ARN para notificaciones.'; fi
aws logs put-metric-filter --region "$AWS_REGION" --log-group-name "$LOG_GROUP" \
  --filter-name spookython-route-p95 --filter-pattern '{ $.event = "backend-metrics" }' \
  --metric-transformations 'metricName=RouteP95Ms,metricNamespace=Spookython,metricValue=$.routeP95Ms,unit=Milliseconds'
aws logs put-metric-filter --region "$AWS_REGION" --log-group-name "$LOG_GROUP" \
  --filter-name spookython-persistence-failure --filter-pattern '{ $.event = "persistence-alarm" }' \
  --metric-transformations 'metricName=PersistenceFailures,metricNamespace=Spookython,metricValue=1,defaultValue=0,unit=Count'
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name spookython-route-p95-high --namespace Spookython --metric-name RouteP95Ms \
  --statistic Maximum --period 60 --evaluation-periods 1 --threshold 150 \
  --comparison-operator GreaterThanThreshold --treat-missing-data missing "${actions[@]}"
aws cloudwatch put-metric-alarm --region "$AWS_REGION" \
  --alarm-name spookython-persistence-failed --namespace Spookython --metric-name PersistenceFailures \
  --statistic Sum --period 60 --evaluation-periods 1 --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching "${actions[@]}"

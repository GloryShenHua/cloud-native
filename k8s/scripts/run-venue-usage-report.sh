#!/usr/bin/env bash
set -euo pipefail

date_pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
if [[ $# -ne 3 || ! $2 =~ $date_pattern || ! $3 =~ $date_pattern ]]; then
  echo "Usage: $0 JOB_NAME START_DATE END_DATE (dates: YYYY-MM-DD, inclusive)" >&2
  exit 2
fi

# Keep manual Jobs independent of the CronJob's schedule and history limits.
kubectl -n venue-booking create job "$1" --from=cronjob/venue-usage-report-cron --dry-run=client -o yaml |
  kubectl patch --local -f - --type=merge -p '{"metadata":{"ownerReferences":null}}' -o yaml |
  kubectl set env --local -f - "REPORT_START_DATE=$2" "REPORT_END_DATE=$3" -o yaml |
  kubectl -n venue-booking create -f -

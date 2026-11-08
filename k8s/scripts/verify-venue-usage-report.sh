#!/usr/bin/env bash
set -euo pipefail

K8S_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUN_ID="$(date +%s)-$$"
MANUAL="report-manual-${RUN_ID}"
INVALID="report-invalid-${RUN_ID}"
DEMO_CRON="report-demo-${RUN_ID}"

k() { kubectl -n venue-booking "$@"; }
db() {
  k exec -i database-0 -- sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
}

k get cronjob venue-usage-report-cron
read -r START END VENUE_ID EMPTY_ID <<<"$(db -qAtF ' ' -v fixture="${RUN_ID}" <<'SQL'
SET TIME ZONE 'Asia/Shanghai';
WITH new_venues AS (
    INSERT INTO venues (name, location, capacity, opening_time, closing_time, status)
    SELECT :'fixture' || suffix, 'Lab 2 test', 10, '08:00', '20:00', 'OPEN'
    FROM (VALUES ('-used'), ('-empty')) AS v(suffix)
    RETURNING id, name
), new_reservations AS (
    INSERT INTO reservations (venue_id, organizer, reservation_date, start_time, end_time, purpose, status)
    SELECT v.id, 'Lab 2 test', CURRENT_DATE - r.days_ago, r.starts::time, r.ends::time, 'Report test', r.status
    FROM new_venues v
    CROSS JOIN (VALUES (2, '09:00', '10:00', 'ACTIVE'), (1, '10:00', '10:30', 'ACTIVE'),
                       (1, '11:00', '13:00', 'CANCELLED'), (0, '10:00', '10:30', 'ACTIVE'))
        AS r(days_ago, starts, ends, status)
    WHERE v.name = :'fixture' || '-used'
)
SELECT CURRENT_DATE - 2, CURRENT_DATE - 1,
       max(id) FILTER (WHERE name = :'fixture' || '-used'),
       max(id) FILTER (WHERE name = :'fixture' || '-empty')
FROM new_venues;
SQL
)"
printf '测试场地 %s（有预约）与 %s（零预约），手动区间 %s 至 %s\n' "${VENUE_ID}" "${EMPTY_ID}" "${START}" "${END}"

"${K8S_DIR}/scripts/run-venue-usage-report.sh" "${MANUAL}" "${START}" "${END}"
"${K8S_DIR}/scripts/run-venue-usage-report.sh" "${INVALID}" "${END}" "${START}"
kubectl patch --local -f "${K8S_DIR}/50-venue-usage-report.yaml" --type=merge \
  -p "{\"metadata\":{\"name\":\"${DEMO_CRON}\"},\"spec\":{\"schedule\":\"* * * * *\"}}" -o yaml | k create -f -
trap 'k delete cronjob "${DEMO_CRON}" --cascade=orphan --ignore-not-found --wait=false >/dev/null' EXIT

show_job() {
  k get job "$1" -o 'custom-columns=JOB:.metadata.name,START:.status.startTime,END:.status.completionTime,CONDITIONS:.status.conditions[*].type'
  k logs "job/$1"
}

report_totals() {
  db -AtF '|' -v job_name="$1" -v used_id="${VENUE_ID}" -v empty_id="${EMPTY_ID}" <<'SQL'
SELECT r.start_date, r.end_date, (r.generated_at AT TIME ZONE 'Asia/Shanghai')::date - 1,
       max(t.reservation_count) FILTER (WHERE t.venue_id = :'used_id'::bigint),
       max(t.total_reserved_seconds) FILTER (WHERE t.venue_id = :'used_id'::bigint),
       max(t.reservation_count) FILTER (WHERE t.venue_id = :'empty_id'::bigint),
       max(t.total_reserved_seconds) FILTER (WHERE t.venue_id = :'empty_id'::bigint)
FROM venue_usage_reports r
CROSS JOIN LATERAL jsonb_to_recordset(r.venue_totals) AS t(
    venue_id bigint, reservation_count bigint, total_reserved_seconds bigint
)
WHERE r.job_name = :'job_name'
GROUP BY r.job_uid;
SQL
}

check_report() {
  local actual=$1 expected_start=$2 expected_end=$3 expected_totals=$4
  printf 'PostgreSQL（开始|结束|生成日的前一天|预约数|秒数|空场地预约数|秒数）\n%s\n' "${actual}"
  if [[ "${actual}" != "${expected_start}|${expected_end}|"*"|${expected_totals}|0|0" || "${actual}" == *$'\n'* ]]; then
    echo '报告统计或记录数量不符合预期' >&2
    exit 1
  fi
}

k wait --for=condition=Complete "job/${MANUAL}" --timeout=120s
show_job "${MANUAL}"
BEFORE=$(report_totals "${MANUAL}")
check_report "${BEFORE}" "${START}" "${END}" '2|5400'

UID_VALUE=$(k get job "${MANUAL}" -o jsonpath='{.metadata.uid}')
REPLAY=$(db -v job_uid="${UID_VALUE}" -v job_name="${MANUAL}" -v start_date="${START}" -v end_date="${END}" \
  < "${K8S_DIR}/report/venue-usage.sql")
printf '%s\n' "${REPLAY}"
grep -qx 'INSERT 0 0' <<<"${REPLAY}"
[[ "$(report_totals "${MANUAL}")" == "${BEFORE}" ]]

k wait --for=condition=Failed "job/${INVALID}" --timeout=150s
show_job "${INVALID}"
[[ -z "$(report_totals "${INVALID}")" ]]

k wait --for=jsonpath='{.status.lastScheduleTime}' "cronjob/${DEMO_CRON}" --timeout=100s
AUTO=$(k get jobs --no-headers -o 'custom-columns=JOB:.metadata.name,OWNER:.metadata.ownerReferences[0].name' |
  awk -v owner="${DEMO_CRON}" '$2 == owner && !found {print $1; found=1}')
k wait --for=condition=Complete "job/${AUTO}" --timeout=120s
show_job "${AUTO}"
k get job "${AUTO}" -o 'jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}{"\n"}'
AUTO_TOTALS=$(report_totals "${AUTO}")
YESTERDAY=$(cut -d '|' -f 3 <<<"${AUTO_TOTALS}")
[[ -n "${YESTERDAY}" ]]
check_report "${AUTO_TOTALS}" "${YESTERDAY}" "${YESTERDAY}" '1|1800'
k get cronjob venue-usage-report-cron
echo 'PASS 手动 Job、重复执行、失败状态与 CronJob 自动调度'

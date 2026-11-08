SET TIME ZONE 'Asia/Shanghai';

WITH report_window AS (
    SELECT COALESCE(NULLIF(:'start_date', '')::date, CURRENT_DATE - 1) AS start_date,
           COALESCE(NULLIF(:'end_date', '')::date, CURRENT_DATE - 1) AS end_date
), venue_usage AS (
    SELECT v.id AS venue_id, v.name AS venue_name,
           COUNT(r.id) AS reservation_count,
           COALESCE(SUM(EXTRACT(EPOCH FROM (r.end_time - r.start_time))), 0)::bigint
               AS total_reserved_seconds
    FROM venues v
    CROSS JOIN report_window w
    LEFT JOIN reservations r ON r.venue_id = v.id
        AND r.status = 'ACTIVE'
        AND r.reservation_date BETWEEN w.start_date AND w.end_date
    GROUP BY v.id, v.name
)
INSERT INTO venue_usage_reports (job_uid, job_name, start_date, end_date, venue_totals)
SELECT :'job_uid'::uuid, :'job_name', w.start_date, w.end_date,
       (SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.venue_id), '[]'::jsonb)
        FROM venue_usage u)
FROM report_window w
ON CONFLICT (job_uid) DO NOTHING;

SELECT job_name, start_date, end_date, generated_at, jsonb_array_length(venue_totals) AS venues
FROM venue_usage_reports
WHERE job_uid = :'job_uid'::uuid;

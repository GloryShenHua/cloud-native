CREATE TABLE venue_usage_reports (
    job_uid UUID PRIMARY KEY,
    job_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
    venue_totals JSONB NOT NULL,
    CONSTRAINT valid_venue_usage_report_dates CHECK (start_date <= end_date)
);

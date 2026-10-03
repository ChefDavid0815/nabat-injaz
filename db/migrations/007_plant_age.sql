ALTER TABLE plants ADD COLUMN IF NOT EXISTS age_months_estimate integer CHECK(age_months_estimate BETWEEN 0 AND 3000);

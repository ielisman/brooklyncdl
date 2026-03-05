-- ============================================================
-- INDEXES FOR COLUMN SORTING AND FILTERING
-- Date: March 4, 2026
-- Description: Indexes required after adding sortable/filterable
--              columns to the admin student management table.
--
-- RUN ORDER:
--   1. Enable pg_trgm extension (required for ILIKE '%foo%' indexes)
--   2. Run this file
-- ============================================================

-- STEP 1: Enable trigram extension (required for GIN ILIKE indexes)
-- This is safe to run multiple times.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ============================================================
-- CRITICAL: user_assigned_courses.company_id
-- ============================================================
-- Every admin query filters by uac.company_id. The existing
-- idx_uac_user_course(user_id, course_id) does NOT cover this.
-- idx_users_company_id is on the users table, not uac — doesn't help.
CREATE INDEX IF NOT EXISTS idx_uac_company_id_active
  ON user_assigned_courses(company_id, active);


-- ============================================================
-- DEFAULT SORT: users.registration_date
-- ============================================================
-- Every page load (no explicit sort) orders by sl.registration_date DESC.
-- No index currently exists for this column.
CREATE INDEX IF NOT EXISTS idx_users_registration_date
  ON users(registration_date DESC);


-- ============================================================
-- GIN TRIGRAM INDEXES FOR ILIKE FILTERING
-- ============================================================
-- Standard B-tree indexes are USELESS for ILIKE '%foo%' (leading wildcard).
-- pg_trgm GIN indexes support partial-match ILIKE efficiently.
--
-- Covers: filterName, search (first_name + last_name)
CREATE INDEX IF NOT EXISTS idx_users_first_name_trgm
  ON users USING GIN (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_last_name_trgm
  ON users USING GIN (last_name gin_trgm_ops);

-- Covers: filterLicense, search (license_number)
-- Note: existing idx_users_email B-tree does NOT help ILIKE '%foo%'.
CREATE INDEX IF NOT EXISTS idx_users_license_trgm
  ON users USING GIN (license_number gin_trgm_ops);

-- Covers: filterPhone
CREATE INDEX IF NOT EXISTS idx_users_phone_trgm
  ON users USING GIN (phone gin_trgm_ops);

-- Covers: filterEmail (replaces/supplements existing B-tree idx_users_email
--         which only helps exact lookups, not ILIKE '%foo%')
CREATE INDEX IF NOT EXISTS idx_users_email_trgm
  ON users USING GIN (email gin_trgm_ops);

-- Covers: filterState (ILIKE partial match)
CREATE INDEX IF NOT EXISTS idx_users_state_trgm
  ON users USING GIN (state gin_trgm_ops);

-- Covers: filterCourse (c.name ILIKE)
CREATE INDEX IF NOT EXISTS idx_courses_name_trgm
  ON courses USING GIN (name gin_trgm_ops);


-- ============================================================
-- B-TREE INDEXES FOR COLUMN SORTING
-- ============================================================
-- When the user clicks a column header, ORDER BY runs on that column.
-- These allow index scans instead of full sort passes.

-- Sort by Name (last_name ASC/DESC)
CREATE INDEX IF NOT EXISTS idx_users_last_name
  ON users(last_name);

-- Sort by DOB
CREATE INDEX IF NOT EXISTS idx_users_dob
  ON users(dob);

-- Sort by License Number
CREATE INDEX IF NOT EXISTS idx_users_license_number
  ON users(license_number);

-- Sort by State (exact, also used in stateFilter equality check)
CREATE INDEX IF NOT EXISTS idx_users_state
  ON users(state);

-- Sort by Phone
CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users(phone);

-- Note: email sort can reuse existing idx_users_email B-tree.
-- Note: course name sort would use idx_courses_name_trgm (GIN is slower for
--       pure sort; add a separate B-tree if course-sort performance is needed):
CREATE INDEX IF NOT EXISTS idx_courses_name
  ON courses(name);


-- ============================================================
-- NOT INDEXABLE: filterDob
-- ============================================================
-- The filter uses: TO_CHAR(u.dob, 'MM/DD/YYYY') ILIKE '%foo%'
-- A function applied to the column prevents index use unless a
-- generated/expression index is created. Given DOB filtering is
-- rare and datasets are small, this is acceptable for now.
-- If needed in the future, add a generated column:
--   ALTER TABLE users ADD COLUMN dob_formatted TEXT
--     GENERATED ALWAYS AS (TO_CHAR(dob, 'MM/DD/YYYY')) STORED;
--   CREATE INDEX idx_users_dob_formatted_trgm
--     ON users USING GIN (dob_formatted gin_trgm_ops);


-- ============================================================
-- NOT INDEXABLE: score_percentage sort
-- ============================================================
-- score_percentage is a computed expression (COALESCE of a CASE).
-- Cannot be indexed directly. Sorting by score always requires
-- a full compute + sort pass, which is acceptable.


COMMIT;

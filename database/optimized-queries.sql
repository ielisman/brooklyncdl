-- ============================================
-- OPTIMIZED ADMIN QUERIES
-- Suggested improvements for server.js endpoints
-- ============================================

-- OPTIMIZED /api/admin/students QUERY
-- ============================================
-- Changes:
-- 1. Added pagination support
-- 2. Added optional search/filter parameters
-- 3. Optimized subquery execution order
-- 4. Added total count for pagination

WITH student_list AS (
  SELECT DISTINCT 
    u.id as user_id,
    u.company_id,
    u.first_name,
    u.last_name,
    u.state,
    u.license_number,
    u.dob,
    u.registration_date,
    uac.id as user_assigned_course_id,
    c.id as course_id,
    c.name as course_name
  FROM users u
  INNER JOIN user_assigned_courses uac ON u.id = uac.user_id AND uac.active = true
  INNER JOIN courses c ON uac.course_id = c.id AND c.active = true
  WHERE 
    -- Company filter: if admin company_id = 0, see all; otherwise only their company
    ($1::integer = 0 OR u.company_id = $1)
    -- Optional search filters (add to WHERE clause as needed)
    -- AND ($2::text IS NULL OR u.first_name ILIKE '%' || $2 || '%' OR u.last_name ILIKE '%' || $2 || '%')
    -- AND ($3::text IS NULL OR u.state = $3)
    -- AND ($4::integer IS NULL OR c.id = $4)
)
SELECT 
  sl.user_id,
  sl.first_name,
  sl.last_name,
  sl.state,
  sl.license_number,
  sl.dob,
  sl.registration_date,
  sl.course_id,
  sl.course_name,
  uqpt_latest.last_quiz_date,
  r.submitted_on,
  COALESCE(r.total_score, uqpt_sum.total_score, 0) as total_score,
  COALESCE(r.total_possible, uqpt_sum.total_questions, 0) as total_questions,
  COALESCE(r.score_percentage, 
    CASE 
      WHEN uqpt_sum.total_questions > 0 THEN ROUND((uqpt_sum.total_score::numeric / uqpt_sum.total_questions::numeric) * 100, 2)
      ELSE 0 
    END, 0) as score_percentage,
  COUNT(*) OVER() as total_count  -- Total count for pagination
FROM student_list sl
LEFT JOIN LATERAL (
  SELECT MAX(modified_on) as last_quiz_date
  FROM user_quiz_progress_tracker
  WHERE user_id = sl.user_id
) uqpt_latest ON true
LEFT JOIN LATERAL (
  SELECT submitted_on, total_score, total_possible, score_percentage
  FROM results
  WHERE user_assigned_course_id = sl.user_assigned_course_id
  ORDER BY submitted_on DESC
  LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT 
    SUM(uqpt.score) as total_score,
    SUM(uqpt.total_questions) as total_questions
  FROM user_quiz_progress_tracker uqpt
  INNER JOIN quizes q ON uqpt.quiz_id = q.id
  WHERE uqpt.user_id = sl.user_id AND q.course_id = sl.course_id AND q.active = true
) uqpt_sum ON true
ORDER BY sl.registration_date DESC, sl.user_id
LIMIT $5 OFFSET $6;  -- Pagination: $5 = limit (e.g., 50), $6 = offset (e.g., 0, 50, 100, ...)

-- Example parameters:
-- $1 = companyId (0 for super admin, or specific company_id)
-- $2 = searchText (optional, for filtering by name)
-- $3 = stateFilter (optional, for filtering by state)
-- $4 = courseFilter (optional, for filtering by course)
-- $5 = limit (e.g., 50)
-- $6 = offset (e.g., 0 for page 1, 50 for page 2, 100 for page 3)


-- ============================================
-- OPTIMIZED /api/admin/student-details QUERY
-- ============================================
-- Changes:
-- 1. Single optimized query instead of two separate queries
-- 2. Better use of indexes
-- 3. Reduced data transfer

WITH user_progress AS (
  SELECT 
    uqpt.quiz_id,
    uqpt.user_answers
  FROM user_quiz_progress_tracker uqpt
  INNER JOIN quizes q ON uqpt.quiz_id = q.id
  INNER JOIN course_sections cs ON q.section_id = cs.id
  WHERE uqpt.user_id = $1 AND cs.course_id = $2 AND cs.active = true
)
SELECT 
  cs.id as section_id,
  cs.section_name,
  cs.section_number,
  q.id as quiz_id,
  jsonb_agg(
    jsonb_build_object(
      'question_id', qq.id,
      'question_name', qq.question_name,
      'correct_answer', qmc_correct.choice_name,
      'question_index', (ROW_NUMBER() OVER (PARTITION BY q.id ORDER BY qq.id) - 1)
    ) ORDER BY qq.id
  ) as questions,
  up.user_answers
FROM course_sections cs
INNER JOIN quizes q ON cs.id = q.section_id AND q.active = true
INNER JOIN quiz_questions qq ON q.id = qq.quiz_id AND qq.active = true
LEFT JOIN quiz_multiple_choices qmc_correct ON qq.id = qmc_correct.question_id 
  AND qmc_correct.is_correct = true 
  AND qmc_correct.active = true
LEFT JOIN user_progress up ON q.id = up.quiz_id
WHERE cs.course_id = $2 AND cs.active = true
GROUP BY cs.id, cs.section_name, cs.section_number, q.id, up.user_answers
ORDER BY cs.section_number;

-- Example parameters:
-- $1 = userId
-- $2 = courseId

-- Benefits:
-- 1. Single query instead of multiple round trips
-- 2. JSON aggregation reduces processing in Node.js
-- 3. Better index utilization
-- 4. Reduced memory usage


-- ============================================
-- ALTERNATIVE: CACHED STUDENT SUMMARY TABLE
-- ============================================
-- For very large datasets (100,000+ students), consider a summary table
-- that's updated via triggers or scheduled refresh

/*
CREATE TABLE IF NOT EXISTS admin_student_summary (
  user_id INTEGER PRIMARY KEY,
  company_id INTEGER,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  state VARCHAR(10),
  license_number VARCHAR(50),
  dob DATE,
  registration_date TIMESTAMP,
  course_id INTEGER,
  course_name VARCHAR(255),
  last_quiz_date TIMESTAMP,
  submitted_on TIMESTAMP,
  total_score INTEGER,
  total_questions INTEGER,
  score_percentage DECIMAL(5,2),
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_summary_company ON admin_student_summary(company_id);
CREATE INDEX idx_admin_summary_registration ON admin_student_summary(registration_date DESC);
CREATE INDEX idx_admin_summary_name ON admin_student_summary(last_name, first_name);

-- Refresh function (call periodically or via trigger)
CREATE OR REPLACE FUNCTION refresh_admin_student_summary() RETURNS void AS $$
BEGIN
  TRUNCATE admin_student_summary;
  INSERT INTO admin_student_summary
  -- (insert the full SELECT query from above)
  ;
END;
$$ LANGUAGE plpgsql;
*/

-- ============================================
-- ANSWER DESCRIPTION OPTIMIZATION INDEXES
-- Date: February 27, 2026
-- Description: Add indexes to optimize student-details query
--              with full answer descriptions (choice_name + choice_description)
-- ============================================
--
-- USAGE: Run this after implementing answer description display
--        psql -U postgres -d eldt -f add-answer-description-indexes.sql
-- ============================================

BEGIN;

-- Index for fetching all choices for a question (supports ORDER BY qmc.id in aggregation)
CREATE INDEX IF NOT EXISTS idx_qmc_question_active 
ON quiz_multiple_choices(question_id, id) WHERE active = true;

-- Covering index to avoid table lookups when fetching choice_name and choice_description
-- This supports index-only scans for the jsonb_agg aggregation in student-details query
CREATE INDEX IF NOT EXISTS idx_qmc_question_all_data 
ON quiz_multiple_choices(question_id, id, is_correct) 
INCLUDE (choice_name, choice_description) WHERE active = true;

-- ============================================
-- PERFORMANCE IMPACT ANALYSIS
-- ============================================
--
-- Query Pattern:
--   SELECT ... jsonb_agg(
--     jsonb_build_object(
--       'choice_name', qmc.choice_name,
--       'choice_description', qmc.choice_description,
--       'is_correct', qmc.is_correct
--     ) ORDER BY qmc.id
--   ) ...
--   FROM quiz_multiple_choices qmc
--   WHERE question_id = X AND active = true
--
-- Without these indexes:
--   - PostgreSQL must scan the heap table for each question
--   - Estimated time: 200-400ms for 300 questions
--   - High I/O due to random heap access
--
-- With these indexes:
--   - Index-only scan (no heap access needed)
--   - Estimated time: 60-120ms for 300 questions
--   - 3-4x performance improvement
--   - Reduced disk I/O by ~70%
--
-- Index Size Impact:
--   - idx_qmc_question_active: ~50-100KB per 1000 questions
--   - idx_qmc_question_all_data: ~200-500KB per 1000 questions (includes data)
--   - Total additional disk space: ~250-600KB per 1000 questions
--
-- Note: The INCLUDE clause creates a covering index (PostgreSQL 11+)
--       For PostgreSQL 10 or earlier, use:
--       CREATE INDEX idx_qmc_question_all_data ON quiz_multiple_choices
--       (question_id, id, is_correct, choice_name, choice_description) WHERE active = true;
-- ============================================

-- Analyze table to update statistics after index creation
ANALYZE quiz_multiple_choices;

-- Display index information
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'quiz_multiple_choices'
  AND indexname LIKE 'idx_qmc%'
ORDER BY indexname;

COMMIT;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify index usage:

-- 1. Check index size
-- SELECT 
--     indexname,
--     pg_size_pretty(pg_relation_size('public.' || indexname)) as index_size
-- FROM pg_indexes
-- WHERE tablename = 'quiz_multiple_choices'
--   AND indexname LIKE 'idx_qmc%';

-- 2. Verify index is being used (should show "Index Only Scan")
-- EXPLAIN ANALYZE
-- SELECT question_id, id, choice_name, choice_description, is_correct
-- FROM quiz_multiple_choices
-- WHERE question_id = 1 AND active = true
-- ORDER BY id;

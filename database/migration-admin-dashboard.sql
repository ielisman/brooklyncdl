-- Migration for Admin Dashboard Feature
-- Date: February 24, 2026
-- Description: Add company_id to user_types table and update Company table with additional fields

-- 1. Add company_id column to user_types table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_types' AND column_name = 'company_id'
    ) THEN
        ALTER TABLE user_types ADD COLUMN company_id INTEGER DEFAULT 0;
        COMMENT ON COLUMN user_types.company_id IS '0 = can view all companies, otherwise admin can only view their company';
    END IF;
END $$;

-- 2. Add additional fields to Company table if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'company' AND column_name = 'address'
    ) THEN
        ALTER TABLE company ADD COLUMN address VARCHAR(255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'company' AND column_name = 'city'
    ) THEN
        ALTER TABLE company ADD COLUMN city VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'company' AND column_name = 'state'
    ) THEN
        ALTER TABLE company ADD COLUMN state VARCHAR(10);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'company' AND column_name = 'zip'
    ) THEN
        ALTER TABLE company ADD COLUMN zip VARCHAR(10);
    END IF;
END $$;

-- 3. Create an index on company_id for faster queries
CREATE INDEX IF NOT EXISTS idx_user_types_company_id ON user_types(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- 4. Update existing Admin users to have company_id = 0 (super admin) if not already set
UPDATE user_types 
SET company_id = 0 
WHERE user_type = 'Admin' AND company_id IS NULL;

-- Verification queries (for manual checking)
-- SELECT * FROM user_types WHERE user_type = 'Admin';
-- SELECT * FROM company;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_types';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'company';

COMMIT;

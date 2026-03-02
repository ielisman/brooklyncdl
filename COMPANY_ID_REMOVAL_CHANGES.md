# Company ID Removal - Server.js Updates

**Date:** March 1, 2026  
**Change:** Removed all references to `users.company_id` from server.js

## Summary

All queries updated to work without `users.company_id` column. Company tracking now exclusively uses `user_assigned_courses.company_id` for course enrollments and `user_types.company_id` for admin permissions.

---

## Changes Made

### 1. User Registration (`POST /api/register`)

**BEFORE:**
```javascript
INSERT INTO users (company_id, first_name, last_name, ...)
VALUES ($1, $2, $3, ...)
// company_id was always 0 for students
```

**AFTER:**
```javascript
INSERT INTO users (first_name, last_name, ...)
VALUES ($1, $2, ...)
// No company_id in users table
```

**Impact:**
- ✅ Users can be assigned to courses from different companies
- ✅ Company relationship tracked via `user_assigned_courses` only

---

### 2. User Login (`POST /api/login`)

**BEFORE:**
```sql
SELECT u.id, u.first_name, u.last_name, u.email, u.company_id, ...
FROM users u
```

**AFTER:**
```sql
SELECT u.id, u.first_name, u.last_name, u.email, ...
FROM users u
```

**Impact:**
- ✅ Login response no longer includes company_id (students don't have one)
- ✅ No breaking changes - company_id wasn't used in frontend for students

---

### 3. Admin Student List (`GET /api/admin/students`)

**BEFORE:**
```javascript
// Company filter
if (companyId !== 0) {
  whereConditions.push(`u.company_id = $${paramIndex}`);
}

// CTE
SELECT u.id, u.company_id, u.first_name, ...
FROM users u
```

**AFTER:**
```javascript
// Company filter - use user_assigned_courses.company_id
if (companyId !== 0) {
  whereConditions.push(`uac.company_id = $${paramIndex}`);
}

// CTE
SELECT u.id, u.first_name, uac.company_id, ...
FROM users u
INNER JOIN user_assigned_courses uac ...
```

**Impact:**
- ✅ Filters by course assignment company instead of user's company
- ✅ Admin at company 1 sees students enrolled in company 1's courses
- ✅ **FIXES multi-company course enrollment scenario**

---

### 4. Admin Student Details Access Check (`GET /api/admin/student-details/:userId`)

**BEFORE:**
```sql
SELECT u.id FROM users u 
WHERE u.id = $1 AND u.company_id = $2
```

**AFTER:**
```sql
SELECT u.id FROM users u 
INNER JOIN user_assigned_courses uac ON u.id = uac.user_id
WHERE u.id = $1 AND uac.course_id = $2 AND uac.company_id = $3
```

**Impact:**
- ✅ Verifies admin has access to student's specific course enrollment
- ✅ More granular security - checks course-level permission

---

### 5. Admin User Creation (`POST /api/admin/add-admin`)

**BEFORE:**
```javascript
INSERT INTO users (company_id, first_name, last_name, email, ...)
VALUES ($1, $2, $3, $4, ...)
// Stored admin's company_id
```

**AFTER:**
```javascript
INSERT INTO users (first_name, last_name, email, ...)
VALUES ($1, $2, $3, ...)
// Company relationship stored in user_types.company_id
```

**Impact:**
- ✅ Admin's company tracked via `user_types.company_id` (unchanged)
- ✅ Consistent with removal of users.company_id

---

## What Remains Unchanged

### ✅ user_assigned_courses.company_id
- **KEPT** - This is now the primary source of company relationship for course enrollments
- Used in registration: `INSERT INTO user_assigned_courses (user_id, company_id, course_id)`
- Default value: 0 for self-registered students

### ✅ user_types.company_id
- **KEPT** - Tracks company relationship for admin users
- Used in `authenticateAdmin` middleware
- 0 = super admin (can see all companies)
- N = company admin (can only see company N)

### ✅ company.id
- **KEPT** - Company master table remains unchanged

---

## Database Migration Required

You mentioned you'll handle this yourself. For reference, the SQL needed:

```sql
-- Remove company_id column from users table
ALTER TABLE users DROP COLUMN IF EXISTS company_id;
```

**IMPORTANT:** Run this migration AFTER deploying the updated server.js code. The code is now ready and won't reference this column.

---

## Testing Checklist

### ✅ Student Features
- [ ] User registration for Course 1 (company_id=0)
- [ ] User can register for Course 2 (company_id=0 or different)
- [ ] Login works without company_id
- [ ] Course list shows all enrolled courses
- [ ] Quiz progress tracked correctly

### ✅ Admin Features - Company 0 (Super Admin)
- [ ] Can see all students across all companies
- [ ] Student list shows correct company_id from UAC
- [ ] Can view student details for any course
- [ ] Company filter works correctly

### ✅ Admin Features - Company N (Regular Admin)
- [ ] Only sees students enrolled in company N's courses
- [ ] Cannot see students from other companies
- [ ] Can view details only for their company's courses
- [ ] Access denied for other company students

### ✅ Multi-Company Course Enrollment (NEW SCENARIO)
- [ ] Student enrolled in Course 1 (company 0) and Course 2 (company 1)
- [ ] Admin at company 0 sees both course enrollments
- [ ] Admin at company 1 sees only Course 2 enrollment
- [ ] Each enrollment shows correct company_id
- [ ] Progress tracked separately per course

---

## Expected Behavior Changes

### Before (with users.company_id):
```
User ID 123: company_id=0 (in users table)
- Course 1 enrollment: company_id=0
- Course 2 enrollment: company_id=1
- Admin at company 1 sees: NOTHING (filtered by users.company_id=0)
```

### After (without users.company_id):
```
User ID 123: no company_id in users table
- Course 1 enrollment: company_id=0
- Course 2 enrollment: company_id=1
- Admin at company 0 sees: Both courses
- Admin at company 1 sees: Course 2 only ✅
```

---

## Benefits of This Change

1. **✅ Flexible Company Relationships**
   - Users can take courses from multiple companies
   - No artificial constraint of single company per user

2. **✅ Correct Admin Visibility**
   - Admins see students based on course enrollments
   - Company filter works correctly for multi-company scenarios

3. **✅ Cleaner Data Model**
   - Single source of truth for company relationships
   - No duplicate/conflicting company_id storage

4. **✅ Future-Proof**
   - Supports B2B scenarios (company buying courses for employees)
   - Supports marketplace scenarios (students from different companies)
   - Supports course transfers between companies

---

## Deployment Steps

1. ✅ **Code deployed** - server.js updated and running in Docker
2. ⏳ **Database migration** - You will run: `ALTER TABLE users DROP COLUMN company_id`
3. ⏳ **Verification** - Test admin dashboard and student features
4. ⏳ **Monitor** - Check logs for any errors

---

## Rollback Plan (If Needed)

If you need to rollback:

1. Re-add column: `ALTER TABLE users ADD COLUMN company_id INTEGER DEFAULT 0;`
2. Redeploy previous version of server.js
3. Populate company_id: 
   ```sql
   UPDATE users u
   SET company_id = COALESCE(
     (SELECT company_id FROM user_assigned_courses 
      WHERE user_id = u.id 
      ORDER BY id LIMIT 1), 
     0
   );
   ```

---

## Files Modified

- ✅ `server.js` - 7 query updates
- ✅ Deployed to Docker

## Files NOT Modified

- `database/schema.sql` - You'll update this when migrating
- `admin-dashboard.html` - No changes needed (uses API response)
- Other files - No changes needed

---

## Summary

**Status:** ✅ Code ready for database migration

All server.js queries updated to work without `users.company_id`. Once you drop the column from the database, the system will properly support multi-company course enrollments with correct admin visibility.

# Company ID Mismatch Analysis

**Date:** March 1, 2026  
**Issue:** User with multiple course assignments across different companies

## Scenario

**User Registration Path:**
1. User registers for Course 1 → company_id=0
   - `users`: id=123, email=user@test.com, **company_id=0**
   - `user_assigned_courses`: user_id=123, **company_id=0**, course_id=1

2. User registers for Course 2 → company_id=1
   - `users`: (same record, **company_id still 0**)
   - `user_assigned_courses`: user_id=123, **company_id=1**, course_id=2

**Result:** Data Inconsistency - user has company_id=0 in users table, but has a course assignment with company_id=1

---

## Current System Behavior

### 🔴 PROBLEM #1: Registration Blocked

**Location:** `/api/register` line 351

```javascript
const existingUserByEmail = await db.query('SELECT id FROM users WHERE email = $1', [email]);
if (existingUserByEmail.rows.length > 0) {
  return res.status(409).json({ error: 'An account with these credentials already exists' });
}
```

**Impact:**
- ❌ User **CANNOT** register for Course 2 at all
- System blocks on email uniqueness
- This prevents the scenario from happening in the first place

**Current Status:** The scenario you described is **IMPOSSIBLE** with current code.

---

## If Registration Was Allowed (Hypothetical Analysis)

Let's assume we modified registration to allow existing users to add new courses with different company_ids.

### Query-by-Query Impact

#### ❌ 1. Admin Student List (`GET /api/admin/students`)

**Query Logic:**
```sql
SELECT u.id, u.first_name, u.last_name, c.id as course_id, c.name as course_name
FROM users u
INNER JOIN user_assigned_courses uac ON u.id = uac.user_id
INNER JOIN courses c ON uac.course_id = c.id
WHERE u.company_id = $1 OR $1 = 0  -- Admin's company filter
```

**Problem:**
- Admin with company_id=1 views dashboard
- Query filters: `WHERE u.company_id = 1`
- User's `users.company_id` is 0
- **Result:** Admin at company 1 **CANNOT SEE** this user, even though they have course 2 with company_id=1!

**Data Returned:**
```json
// Admin company_id=0 (sees all)
[
  { "user_id": 123, "course_id": 1, "company_id": 0 },  ✅ Shows
  { "user_id": 123, "course_id": 2, "company_id": 0 }   ✅ Shows (wrong company_id!)
]

// Admin company_id=1 (should see course 2)
[]  ❌ EMPTY - Can't see user because users.company_id=0
```

**Severity:** 🔴 CRITICAL - Company 1 admin cannot see their students

---

#### ❌ 2. Admin Company Filter

**Current Filter Logic:**
```javascript
if (companyId !== 0) {
  whereConditions.push(`u.company_id = $${paramIndex}`);
  params.push(companyId);
}
```

**Problem:**
- Uses `users.company_id` instead of `user_assigned_courses.company_id`
- Cannot filter students by their course assignment company

**Impact:**
- Company 1 admin filters by company 1
- Doesn't see user with Course 2 (even though UAC has company_id=1)
- **Completely broken for multi-company course assignments**

---

#### ⚠️ 3. Get User Courses (`GET /api/user/courses`)

**Query Logic:**
```sql
SELECT c.id, c.name, uac.id as assignment_id
FROM courses c
JOIN user_assigned_courses uac ON c.id = uac.course_id
WHERE uac.user_id = $1 AND uac.active = true AND c.active = true
```

**Status:** ✅ Works correctly
- Doesn't filter by company_id at all
- Returns all courses regardless of company
- User sees both Course 1 and Course 2

**Impact:** No issue for students

---

#### ✅ 4. Progress Tracking Queries

**Queries:** Save progress, submit quiz, get results

**Status:** ✅ Work correctly
- Use `user_id` and `quiz_id` or `course_id`
- Don't depend on `company_id` from users table
- Progress tracked correctly per course

**Impact:** No functional issues

---

#### ❌ 5. Results Submission (`POST /api/results/submit`)

**Query Logic:**
```sql
INSERT INTO results (user_assigned_course_id, total_score, ...)
VALUES (...);
```

**Status:** ⚠️ Works but creates inconsistency

**Problem:**
- Results saved with `user_assigned_course_id` (which has company_id=1 for course 2)
- But user's master record has company_id=0
- Reports may show incorrect company attribution

---

## Root Cause Analysis

### Architectural Flaw

The system has **dual company_id storage** without proper relationship:

```
┌─────────────────┐
│  users table    │
│  id: 123        │
│  company_id: 0  │  ← SINGLE company_id
└─────────────────┘
        │
        │ user_id FK
        ▼
┌───────────────────────────────┐
│  user_assigned_courses table  │
│  user_id: 123                 │
│  company_id: 0, course_id: 1  │  ← Per-assignment company_id
│  company_id: 1, course_id: 2  │  ← DIFFERENT company_id!
└───────────────────────────────┘
```

**Design Conflict:**
- `users.company_id` implies: "User belongs to ONE company"
- `user_assigned_courses.company_id` implies: "User can have courses from different companies"

These two assumptions are contradictory!

---

## Impact Summary

| Query/Feature | Works? | Issue |
|---------------|--------|-------|
| Student registration | ❌ | Blocked by email uniqueness |
| Admin student list (company 0) | ⚠️ | Shows all, but wrong company attribution |
| Admin student list (company 1) | ❌ | Cannot see user at all |
| Company filtering | ❌ | Filters by wrong company_id |
| User's course list | ✅ | Works |
| Progress tracking | ✅ | Works |
| Quiz submission | ✅ | Works |
| Results submission | ⚠️ | Works but data inconsistent |
| Analytics/Reporting | ❌ | Company attribution wrong |

---

## Recommended Solutions

### Option 1: Remove company_id from users table (RECOMMENDED)

**Rationale:**
- User can belong to multiple companies via course assignments
- `users.company_id` is redundant and causes conflicts
- All company relationships should be in `user_assigned_courses`

**Changes Required:**
```sql
-- Migration
ALTER TABLE users DROP COLUMN company_id;

-- Update admin queries to use UAC company_id
WHERE uac.company_id = $1 OR $1 = 0
```

**Pros:**
- ✅ Clean data model
- ✅ Supports multi-company scenarios
- ✅ No data inconsistency possible

**Cons:**
- ⚠️ Requires database migration
- ⚠️ Need to update all queries using users.company_id

---

### Option 2: Enforce company_id consistency

**Rationale:**
- Keep users.company_id as the "master" company
- Require all course assignments to use the same company_id

**Changes Required:**
```sql
-- Add constraint
ALTER TABLE user_assigned_courses
ADD CONSTRAINT fk_user_company CHECK (
  company_id = (SELECT company_id FROM users WHERE id = user_id)
);

-- Update registration to use user's existing company_id for new courses
```

**Pros:**
- ✅ Maintains data consistency
- ✅ Less query changes needed

**Cons:**
- ❌ User CANNOT take courses from different companies
- ❌ Reduces flexibility
- ❌ May not match business requirements

---

### Option 3: Make users.company_id nullable/optional

**Rationale:**
- For self-registered students, company_id = NULL
- For company-assigned students, company_id = their company
- Use UAC company_id for course-specific company tracking

**Changes Required:**
```sql
-- Allow NULL
ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL;

-- Update default to NULL for student registrations
INSERT INTO users (..., company_id, ...)
VALUES (..., NULL, ...);  -- For students

-- Admin query changes
WHERE (uac.company_id = $1 OR $1 = 0)  -- Use UAC company_id
```

**Pros:**
- ✅ Flexible for different use cases
- ✅ Students not tied to single company
- ✅ Supports scenario you described

**Cons:**
- ⚠️ More complex logic
- ⚠️ Need to update many queries

---

## Immediate Actions Needed

### 🔴 CRITICAL: Block the Scenario

**Current Status:** Already blocked by email uniqueness ✅

**If you want to allow it:**
1. Choose one of the three options above
2. Implement database constraints
3. Update ALL queries to use consistent company_id source

### 🟡 Document Business Rules

**Questions to Answer:**
1. Can a user take courses from multiple companies? (Yes/No)
2. Is company_id tied to the user or the course enrollment?
3. How should company admins see students?
   - Only students in their company's courses?
   - Only students whose master record has their company_id?

### 🟢 Add Data Validation

```javascript
// In registration or course assignment:
if (existingUser) {
  const existingCompanyId = existingUser.company_id;
  if (existingCompanyId !== 0 && newCompanyId !== existingCompanyId) {
    throw new Error('User already belongs to a different company');
  }
}
```

---

## Testing Recommendations

### Test Case 1: Current System (Email Blocked)
1. Register user@test.com for Course 1, company_id=0 ✅
2. Try to register user@test.com for Course 2, company_id=1 ❌
3. **Expected:** Registration blocked
4. **Actual:** ✅ Blocked (correct)

### Test Case 2: If Registration Allowed
1. User exists with company_id=0
2. Admin adds Course 2 with company_id=1 for this user
3. Admin at company 1 logs in
4. **Expected:** Should see user in Course 2
5. **Actual:** ❌ Cannot see user (users.company_id=0 doesn't match)

### Test Case 3: Company Filter
1. User has Course 1 (company 0) and Course 2 (company 1)
2. Admin filters by company 1
3. **Expected:** Shows user with Course 2 only
4. **Actual:** ❌ Shows nothing (filters by users.company_id)

---

## Conclusion

**Your Scenario:** User registered with company_id=0, signs up for course with company_id=1

**Answer:** 
- ❌ **NOT CURRENTLY POSSIBLE** - Registration blocked by email uniqueness
- ❌ **IF ALLOWED, QUERIES WOULD FAIL** - Admin queries use users.company_id, not UAC company_id
- 🔴 **ARCHITECTURAL ISSUE** - Dual company_id storage creates data inconsistency

**Recommendation:**
1. **Choose a data model** (Option 1 recommended)
2. **Implement constraints** to prevent inconsistency
3. **Update all queries** to use consistent company_id source
4. **Add comprehensive tests** for multi-company scenarios

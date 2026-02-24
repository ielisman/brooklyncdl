# Admin Dashboard Feature

## Overview
The Admin Dashboard provides a comprehensive management interface for administrators to monitor student progress, manage company information, and add additional admin users.

## Features

### 1. Student Management
- **View All Students**: See a complete list of students with their details:
  - Full name
  - State and license number
  - Date of birth
  - Registered course
  - Registration date
  - Last quiz activity date
  - Submission date
  - Current score and percentage

- **Expandable Details**: Click the `+` icon to view detailed quiz results:
  - Section-by-section breakdown
  - Individual question results
  - User's answers vs. correct answers
  - Color-coded feedback (green for correct, red for incorrect)

### 2. Company Information Management
- Update company details:
  - Company name
  - Address, city, state, ZIP
  - Phone and email

### 3. Admin User Management
- Add new administrators to your company
- Set credentials for new admin users
- Maintain multiple admins per company

## Access Control

### Company-Based Filtering
The system uses a `company_id` field in the `user_types` table to control access:

- **company_id = 0**: Super Admin
  - Can view all students across all companies
  - Can manage all company data
  
- **company_id > 0**: Company Admin
  - Can only view students assigned to their company
  - Can only manage their own company information

### User Types
- **Student**: Regular users taking courses
- **Admin**: Company administrators with dashboard access
- **Company Admin**: (Reserved for future use)

## Files Created/Modified

### New Files
1. **admin-dashboard.html**
   - Main admin interface
   - Responsive table layout
   - Expandable student details
   - Left sidebar navigation

2. **database/migration-admin-dashboard.sql**
   - Adds `company_id` to `user_types` table
   - Adds address fields to `company` table
   - Creates necessary indexes

### Modified Files
1. **server.js**
   - Added `/api/admin/students` endpoint
   - Added `/api/admin/student-details/:userId` endpoint
   - Added `/api/admin/company` endpoint (GET and POST)
   - Added `/api/admin/add-admin` endpoint
   - Updated `/api/auth/status` to return userType and companyId

2. **index.html**
   - Added Admin Dashboard link on user welcome page
   - Link only visible to users with Admin privileges

3. **database/schema.sql**
   - Updated `user_types` table definition
   - Updated `company` table with address fields

## Database Schema Changes

### user_types Table
```sql
ALTER TABLE user_types ADD COLUMN company_id INTEGER DEFAULT 0;
```

### company Table
```sql
ALTER TABLE company ADD COLUMN address VARCHAR(255);
ALTER TABLE company ADD COLUMN city VARCHAR(100);
ALTER TABLE company ADD COLUMN state VARCHAR(10);
ALTER TABLE company ADD COLUMN zip VARCHAR(10);
```

## API Endpoints

### Authentication
All admin endpoints require authentication via JWT token. The `authenticateAdmin` middleware checks:
1. Valid JWT token
2. User has Admin user_type
3. Returns admin's company_id for filtering

### Endpoints

#### GET /api/admin/students
Returns list of all students filtered by admin's company_id.

**Response:**
```json
[
  {
    "user_id": 1,
    "first_name": "John",
    "last_name": "Doe",
    "state": "NY",
    "license_number": "D1234567",
    "dob": "1990-01-01",
    "course_name": "Class A CDL Theory",
    "registration_date": "2026-02-10 10:00:00",
    "last_quiz_date": "2026-02-20 15:30:00",
    "submitted_on": "2026-02-23 18:00:00",
    "total_score": 85,
    "total_questions": 100,
    "score_percentage": 85
  }
]
```

#### GET /api/admin/student-details/:userId?courseId=1
Returns detailed quiz results for a specific student.

**Response:**
```json
{
  "sections": [
    {
      "section_id": 1,
      "section_name": "Vehicle Inspection",
      "section_number": 1,
      "score": 18,
      "total_questions": 20,
      "questions": [
        {
          "question_id": 1,
          "question_number": 1,
          "question_name": "What should you check first?",
          "correct_answer": "Tires and wheels",
          "user_answer": "Tires and wheels",
          "is_correct": 1
        }
      ]
    }
  ]
}
```

#### GET /api/admin/company
Returns company information for admin's company.

**Response:**
```json
{
  "company_name": "Brooklyn CDL Training",
  "address": "123 Main St",
  "city": "Brooklyn",
  "state": "NY",
  "zip": "11201",
  "phone": "(718) 555-1234",
  "email": "info@brooklyncdl.com"
}
```

#### POST /api/admin/company
Saves/updates company information.

**Request Body:**
```json
{
  "companyName": "Brooklyn CDL Training",
  "address": "123 Main St",
  "city": "Brooklyn",
  "state": "NY",
  "zip": "11201",
  "phone": "(718) 555-1234",
  "email": "info@brooklyncdl.com"
}
```

#### POST /api/admin/add-admin
Creates a new admin user for the company.

**Request Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@brooklyncdl.com",
  "password": "SecureP@ss123"
}
```

## Setup Instructions

### 1. Run Database Migration
```bash
psql -U postgres -d brooklyncdl -f database/migration-admin-dashboard.sql
```

### 2. Create Initial Admin User (if needed)
```sql
-- Create admin user in users table
INSERT INTO users (company_id, first_name, last_name, email, registration_date, active)
VALUES (0, 'Super', 'Admin', 'admin@brooklyncdl.com', CURRENT_TIMESTAMP, true)
RETURNING id;

-- Insert login credentials (use bcrypt hash)
INSERT INTO user_login (user_id, user_name, password_hash)
VALUES (1, 'admin@brooklyncdl.com', '$2a$10$...');

-- Set user type as Admin
INSERT INTO user_types (user_id, user_type, company_id)
VALUES (1, 'Admin', 0);
```

### 3. Access Admin Dashboard
1. Login with admin credentials at index.html
2. Click "Admin Dashboard" link on welcome page
3. Or navigate directly to admin-dashboard.html (requires authentication)

## Security Considerations

1. **Authentication Required**: All admin endpoints check for valid JWT token
2. **Role-Based Access**: Only users with Admin user_type can access dashboard
3. **Company Filtering**: Admins can only view data for their assigned company
4. **Password Requirements**: 8+ characters with uppercase, lowercase, number, and special character
5. **HTTP-Only Cookies**: JWT tokens stored in HTTP-only cookies
6. **SQL Injection Prevention**: All queries use parameterized statements

## Usage Examples

### Viewing Student Details
1. Navigate to admin-dashboard.html
2. Click on any student row
3. Click the `+` icon to expand details
4. Review section scores and individual question results
5. Green rows = correct answers, Red rows = incorrect answers

### Adding Company Information
1. Click "Company Information" in left sidebar
2. Fill in company details
3. Click "Save Company Information"

### Adding New Admin
1. Click "Add Admin User" in left sidebar
2. Enter admin details and credentials
3. Click "Create Admin User"
4. New admin will have access to same company students

## Troubleshooting

### Can't See Students
- Verify user has Admin user_type in user_types table
- Check company_id matches between admin and students
- Ensure students have courses assigned via user_assigned_courses table

### Company Information Not Saving
- Verify company_id is set correctly for admin
- Check database permissions
- Review server logs for SQL errors

### Admin Link Not Showing
- Clear browser cache and localStorage
- Verify JWT token is valid
- Check that user_types.user_type = 'Admin'

## Future Enhancements

1. **Export Functionality**: Download student reports as PDF/Excel
2. **Bulk Operations**: Import/export student data
3. **Email Notifications**: Notify admins of student completions
4. **Analytics Dashboard**: Charts and graphs for company performance
5. **Certificate Management**: Approve and issue certificates
6. **Course Assignment**: Assign courses to students from dashboard
7. **Messaging System**: Communicate with students directly

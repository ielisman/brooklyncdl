-- Brooklyn CDL ELDT PostgreSQL Database Schema
-- Created: January 30, 2026

-- 1. Company Table
CREATE TABLE Company (
    Id SERIAL PRIMARY KEY,
    Name VARCHAR(255) NOT NULL,
    Address VARCHAR(255),
    City VARCHAR(100),
    State VARCHAR(10),
    Zip VARCHAR(10),
    Phone VARCHAR(20),
    Email VARCHAR(255),
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 2. Users Table
CREATE TABLE Users (
    Id SERIAL PRIMARY KEY,
    Company_Id INTEGER REFERENCES Company(Id) DEFAULT 0,
    First_Name VARCHAR(100) NOT NULL,
    Last_Name VARCHAR(100) NOT NULL,
    DOB DATE,
    Email VARCHAR(255) UNIQUE NOT NULL,
    Phone VARCHAR(20),
    License_Number VARCHAR(50),
    Street VARCHAR(255),
    Apartment VARCHAR(50),
    City VARCHAR(100),
    State VARCHAR(10),
    Zipcode VARCHAR(10),
    Registration_Date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 3. User Login Table
CREATE TABLE User_Login (
    Id SERIAL PRIMARY KEY,
    User_Id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
    User_Name VARCHAR(255) UNIQUE NOT NULL, -- This will be email
    Password_Hash VARCHAR(255) NOT NULL,
    Last_Login TIMESTAMP,
    Number_Of_Login_Attempts INTEGER DEFAULT 0,
    UNIQUE(User_Id)
);

-- 4. User Types Table
CREATE TABLE User_Types (
    Id SERIAL PRIMARY KEY,
    User_Id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
    User_Type VARCHAR(50) NOT NULL CHECK (User_Type IN ('Student', 'Company Admin', 'Admin')),
    Company_Id INTEGER DEFAULT 0 -- 0 = can view all companies, otherwise admin can only view their company
);

-- 5. Courses Table
CREATE TABLE Courses (
    Id SERIAL PRIMARY KEY,
    Name VARCHAR(255) NOT NULL,
    Description TEXT,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 6. Course Sections Table
CREATE TABLE Course_Sections (
    Id SERIAL PRIMARY KEY,
    Course_Id INTEGER REFERENCES Courses(Id) ON DELETE CASCADE,
    Section_Name VARCHAR(255) NOT NULL,
    Section_Number INTEGER,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 7. Quizes Table
CREATE TABLE Quizes (
    Id SERIAL PRIMARY KEY,
    Course_Id INTEGER REFERENCES Courses(Id) ON DELETE CASCADE,
    Section_Id INTEGER REFERENCES Course_Sections(Id) ON DELETE CASCADE,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 8. Quiz Questions Table
CREATE TABLE Quiz_Questions (
    Id SERIAL PRIMARY KEY,
    Quiz_Id INTEGER REFERENCES Quizes(Id) ON DELETE CASCADE,
    Question_Name TEXT NOT NULL,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 9. Quiz Multiple Choices Table
CREATE TABLE Quiz_Multiple_Choices (
    Id SERIAL PRIMARY KEY,
    Question_Id INTEGER REFERENCES Quiz_Questions(Id) ON DELETE CASCADE,
    Choice_Name TEXT NOT NULL,
    Choice_Description TEXT,
    Is_Correct BOOLEAN DEFAULT FALSE,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 10. User Assigned Courses Table
CREATE TABLE User_Assigned_Courses (
    Id SERIAL PRIMARY KEY,
    User_Id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
    Company_Id INTEGER REFERENCES Company(Id),
    Course_Id INTEGER REFERENCES Courses(Id) ON DELETE CASCADE,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- 11. User Quiz Progress Table
CREATE TABLE User_Quiz_Progress (
    Id SERIAL PRIMARY KEY,
    User_Assigned_Course_Id INTEGER REFERENCES User_Assigned_Courses(Id) ON DELETE CASCADE,
    Quiz_Id INTEGER REFERENCES Quizes(Id) ON DELETE CASCADE,
    Quiz_Questions_Id INTEGER REFERENCES Quiz_Questions(Id) ON DELETE CASCADE,
    Answer_Id INTEGER REFERENCES Quiz_Multiple_Choices(Id) ON DELETE CASCADE,
    Answered_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Results Table
CREATE TABLE Results (
    Id SERIAL PRIMARY KEY,
    User_Assigned_Course_Id INTEGER REFERENCES User_Assigned_Courses(Id) ON DELETE CASCADE,
    Total_Score INTEGER,
    Total_Possible INTEGER,
    Score_Percentage DECIMAL(5,2),
    Passed BOOLEAN,
    Submitted_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Modified_By INTEGER,
    Modified_On TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    Active BOOLEAN DEFAULT TRUE
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON Users(Email);
CREATE INDEX idx_user_login_username ON User_Login(User_Name);
CREATE INDEX idx_user_assigned_courses_user ON User_Assigned_Courses(User_Id);
CREATE INDEX idx_user_quiz_progress_user_course ON User_Quiz_Progress(User_Assigned_Course_Id);
CREATE INDEX idx_quiz_questions_quiz ON Quiz_Questions(Quiz_Id);
CREATE INDEX idx_quiz_choices_question ON Quiz_Multiple_Choices(Question_Id);

-- Insert default company for users not associated with any company
INSERT INTO Company (Id, Name, Phone, Email, Modified_By, Active) 
VALUES (0, 'Individual Users', NULL, NULL, 1, TRUE);

-- Insert default course (ELDT Class A CDL Theory)
INSERT INTO Courses (Id, Name, Description, Modified_By, Active)
VALUES (1, 'ELDT Class A CDL Theory', 'Entry-Level Driver Training - Class A Commercial Driver License Theory Course', 1, TRUE);

COMMENT ON DATABASE postgres IS 'Brooklyn CDL ELDT Training Platform Database';
COMMENT ON TABLE Company IS 'Companies that can have multiple users enrolled';
COMMENT ON TABLE Users IS 'Student and admin users of the system';
COMMENT ON TABLE User_Login IS 'Authentication credentials for users';
COMMENT ON TABLE User_Types IS 'User role assignments (Student, Company Admin, Admin)';
COMMENT ON TABLE Courses IS 'Available training courses';
COMMENT ON TABLE Course_Sections IS 'Sections within courses';
COMMENT ON TABLE Quizes IS 'Quizzes associated with course sections';
COMMENT ON TABLE Quiz_Questions IS 'Individual questions within quizzes';
COMMENT ON TABLE Quiz_Multiple_Choices IS 'Answer choices for quiz questions';
COMMENT ON TABLE User_Assigned_Courses IS 'Courses assigned to users';
COMMENT ON TABLE User_Quiz_Progress IS 'User progress through quiz questions';
COMMENT ON TABLE Results IS 'Final quiz results and scores';
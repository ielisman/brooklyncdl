require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 80;
const JWT_SECRET = process.env.JWT_SECRET || 'brooklyn-cdl-secret-key-2026';

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('.'));

// Add request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${req.method} ${req.url}`);
  
  if (req.method !== 'GET' || req.url.includes('/api/')) {
    console.log(`   Headers: ${JSON.stringify(req.headers, null, 2)}`);
    if (req.body && Object.keys(req.body).length > 0) {
      const bodyLog = { ...req.body };
      // Don't log full HTML content, just indicate presence
      if (bodyLog.htmlContent) {
        bodyLog.htmlContent = `[HTML Content - ${bodyLog.htmlContent.length} characters]`;
      }
      if (bodyLog.textContent) {
        bodyLog.textContent = `[Text Content - ${bodyLog.textContent.length} characters]`;
      }
      console.log(`   Body: ${JSON.stringify(bodyLog, null, 2)}`);
    }
  }
  
  // Log when response is finished
  res.on('finish', () => {
    console.log(`   Response: ${res.statusCode} ${req.method} ${req.url}`);
  });
  
  next();
});

// Add CORS headers for deployment
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const token = req.cookies.token || 
                req.headers['authorization']?.split(' ')[1] || 
                req.headers['x-auth-token']; // Custom header for VS Code browser
  
  console.log('🔐 Auth check - Token present:', !!token);
  console.log('🔐 Auth check - Cookie token:', !!req.cookies.token);
  console.log('🔐 Auth check - Header auth:', !!req.headers['authorization']);
  console.log('🔐 Auth check - Custom header:', !!req.headers['x-auth-token']);
  
  if (!token) {
    console.log('❌ Auth failed - No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('❌ Auth failed - Invalid token:', err.message);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    console.log('✅ Auth success - User ID:', user.userId);
    req.user = user;
    next();
  });
}

async function calculateCourseProgressSummary(userId, courseId) {
  if (!courseId) {
    throw new Error('courseId is required to calculate progress');
  }

  const progressResult = await db.query(`
      SELECT 
        cs.id as section_id,
        cs.section_name as section_name,
        cs.section_number as section_number,
        q.id as quiz_id,
        COALESCE(uqpt.progress_percentage, 0) as progress_percentage,
        COALESCE(uqpt.is_completed, false) as is_completed,
        COALESCE(uqpt.user_answers, '{}') as user_answers,
        COALESCE(uqpt.current_question, 0) as current_question,
        COALESCE(
          (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id AND qq.active = true),
          0
        ) as total_questions
      FROM course_sections cs
      JOIN quizes q ON cs.id = q.section_id AND q.active = true
      LEFT JOIN user_quiz_progress_tracker uqpt ON q.id = uqpt.quiz_id AND uqpt.user_id = $1
      WHERE cs.course_id = $2 AND cs.active = true
      ORDER BY cs.section_number
    `, [userId, courseId]);

  if (progressResult.rows.length === 0) {
    return {
      courseId,
      sections: [],
      overall: {
        sections_completed: 0,
        total_sections: 0,
        progress_percentage: 0,
        total_score: 0,
        total_questions: 0,
        total_attempted: 0,
        overall_percentage: 0,
        passed: false
      }
    };
  }

  const sectionsWithScores = await Promise.all(progressResult.rows.map(async (section) => {
    let score = 0;
    let attemptedQuestions = 0;
    let userAnswers = section.user_answers;

    if (userAnswers && typeof userAnswers === 'string') {
      try {
        userAnswers = JSON.parse(userAnswers);
      } catch (err) {
        console.warn('⚠️ Unable to parse user_answers JSON:', err.message);
        userAnswers = {};
      }
    }

    if (userAnswers && typeof userAnswers === 'object') {
      attemptedQuestions = Object.keys(userAnswers).length;

      if (attemptedQuestions > 0) {
        const correctAnswersResult = await db.query(`
          SELECT qq.id, qmc.choice_name as correct_answer,
                 ROW_NUMBER() OVER (ORDER BY qq.id) - 1 as array_index
          FROM quiz_questions qq
          JOIN quiz_multiple_choices qmc ON qq.id = qmc.question_id
          WHERE qq.quiz_id = $1 AND qq.active = true AND qmc.is_correct = true
          ORDER BY qq.id
        `, [section.quiz_id]);

        correctAnswersResult.rows.forEach((correctAnswer) => {
          const userAnswerById = userAnswers[correctAnswer.id?.toString()] || userAnswers[correctAnswer.id];
          const userAnswerByIndex = userAnswers[correctAnswer.array_index?.toString()];
          const userAnswer = userAnswerById || userAnswerByIndex;
          if (userAnswer && userAnswer === correctAnswer.correct_answer) {
            score++;
          }
        });
      }
    } else {
      userAnswers = {};
    }

    const totalQuestions = parseInt(section.total_questions) || 0;
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    return {
      ...section,
      score,
      total_questions: totalQuestions,
      attempted_questions: attemptedQuestions,
      percentage,
      current_question: parseInt(section.current_question) || 0
    };
  }));

  const totalSections = sectionsWithScores.length;
  const completedSections = sectionsWithScores.filter(s => s.is_completed).length;
  const totalScore = sectionsWithScores.reduce((sum, s) => sum + s.score, 0);
  const totalQuestions = sectionsWithScores.reduce((sum, s) => sum + s.total_questions, 0);
  const totalAttempted = sectionsWithScores.reduce((sum, s) => sum + s.attempted_questions, 0);
  const overallPercentage = totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0;
  const overallProgress = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;

  return {
    courseId,
    sections: sectionsWithScores.map(s => ({
      section_id: s.section_id,
      section_name: s.section_name,
      section_number: s.section_number,
      quiz_id: s.quiz_id,
      progress_percentage: s.progress_percentage,
      is_completed: s.is_completed,
      score: s.score,
      total_questions: s.total_questions,
      attempted_questions: s.attempted_questions,
      current_question: s.current_question,
      percentage: s.percentage
    })),
    overall: {
      sections_completed: completedSections,
      total_sections: totalSections,
      progress_percentage: overallProgress,
      total_score: totalScore,
      total_questions: totalQuestions,
      total_attempted: totalAttempted,
      overall_percentage: overallPercentage,
      passed: overallPercentage >= 80
    }
  };
}

// Password validation helper
function validatePassword(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[-_!&$#@%^*()+=<>?/|\\{}[\];:'".,~`]/.test(password);
  
  return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
}

// User registration endpoint
app.post('/api/signup', async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔵 [${requestId}] USER SIGNUP REQUEST`);
  
  try {
    const { 
      firstName, lastName, dob, email, phone, licenseNumber, 
      street, apartment, city, state, zipcode, password, confirmPassword 
    } = req.body;

    console.log(`   📧 Email: ${email}`);
    console.log(`   👤 Name: ${firstName} ${lastName}`);

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        requestId: requestId
      });
    }

    // Validate password match
    if (password !== confirmPassword) {
      return res.status(400).json({ 
        error: 'Passwords do not match',
        requestId: requestId
      });
    }

    // Validate password strength
    if (!validatePassword(password)) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character',
        requestId: requestId
      });
    }

    // Check if user already exists
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        error: 'User with this email already exists',
        requestId: requestId
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const userResult = await db.query(`
      INSERT INTO users (company_id, first_name, last_name, dob, email, phone, license_number, street, apartment, city, state, zipcode)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, email, first_name, last_name
    `, [0, firstName, lastName, dob || null, email, phone || null, licenseNumber || null, street || null, apartment || null, city || null, state || null, zipcode || null]);

    const user = userResult.rows[0];

    // Insert user login credentials
    await db.query(`
      INSERT INTO user_login (user_id, user_name, password_hash)
      VALUES ($1, $2, $3)
    `, [user.id, email, passwordHash]);

    // Set default user type as Student
    await db.query(`
      INSERT INTO user_types (user_id, user_type)
      VALUES ($1, $2)
    `, [user.id, 'Student']);

    console.log(`🟢 [${requestId}] USER REGISTERED SUCCESSFULLY`);
    console.log(`   👤 User ID: ${user.id}`);

    res.json({
      success: true,
      message: 'Registration successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      },
      requestId: requestId
    });

  } catch (error) {
    console.log(`💥 [${requestId}] SIGNUP ERROR:`, error.message);
    res.status(500).json({ 
      error: 'Registration failed', 
      details: error.message,
      requestId: requestId
    });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔵 [${requestId}] USER LOGIN REQUEST`);
  
  try {
    const { email, password } = req.body;

    console.log(`   📧 Email: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password required',
        requestId: requestId
      });
    }

    // Get user and login info
    const userResult = await db.query(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.company_id,
              u.registration_date,
              ul.password_hash, ul.number_of_login_attempts,
              ut.user_type
      FROM users u
      JOIN user_login ul ON u.id = ul.user_id
      LEFT JOIN user_types ut ON u.id = ut.user_id
      WHERE u.email = $1 AND u.active = true
    `, [email]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid email or password',
        requestId: requestId
      });
    }

    const user = userResult.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      // Increment login attempts
      await db.query(`
        UPDATE user_login 
        SET number_of_login_attempts = number_of_login_attempts + 1 
        WHERE user_id = $1
      `, [user.id]);

      return res.status(401).json({ 
        error: 'Invalid email or password',
        requestId: requestId
      });
    }

    // Reset login attempts and update last login
    await db.query(`
      UPDATE user_login 
      SET number_of_login_attempts = 0, last_login = CURRENT_TIMESTAMP 
      WHERE user_id = $1
    `, [user.id]);

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: user.user_type || 'Student',
        registerDate: user.registration_date || new Date().toISOString()
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set HTTP-only cookie AND also return token for localStorage fallback
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from 'strict' to 'lax'
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log(`🟢 [${requestId}] LOGIN SUCCESSFUL`);
    console.log(`   👤 User ID: ${user.id}`);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: user.user_type || 'Student',
        registerDate: user.registration_date || new Date().toISOString()
      },
      token: token, // Include token for localStorage fallback
      requestId: requestId
    });

  } catch (error) {
    console.log(`💥 [${requestId}] LOGIN ERROR:`, error.message);
    res.status(500).json({ 
      error: 'Login failed', 
      details: error.message,
      requestId: requestId
    });
  }
});

// User logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Check authentication status
app.get('/api/auth/status', authenticateToken, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user
  });
});

// Get full user profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔵 [${requestId}] GET USER PROFILE REQUEST`);
  console.log(`   👤 User ID: ${req.user.userId}`);
  
  try {
    const userResult = await db.query(`
      SELECT id, first_name, last_name, dob, email, phone, license_number, 
             street, apartment, city, state, zipcode, registration_date
      FROM users 
      WHERE id = $1 AND active = true
    `, [req.user.userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    console.log(`✅ [${requestId}] USER PROFILE LOADED`);

    res.json({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      dob: user.dob,
      email: user.email,
      phone: user.phone,
      license_number: user.license_number,
      street: user.street,
      apartment: user.apartment,
      city: user.city,
      state: user.state,
      zipcode: user.zipcode,
      registration_date: user.registration_date
    });

  } catch (error) {
    console.log(`💥 [${requestId}] GET PROFILE ERROR:`, error.message);
    res.status(500).json({ 
      error: 'Failed to load user profile', 
      details: error.message,
      requestId: requestId
    });
  }
});

// Get user assigned courses
app.get('/api/user/courses', authenticateToken, async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔵 [${requestId}] GET USER COURSES REQUEST`);
  console.log(`   👤 User ID: ${req.user.userId}`);
  
  try {
    const coursesResult = await db.query(`
      SELECT c.id, c.name, c.description, uac.id as assignment_id
      FROM courses c
      JOIN user_assigned_courses uac ON c.id = uac.course_id
      WHERE uac.user_id = $1 AND uac.active = true AND c.active = true
      ORDER BY c.name
    `, [req.user.userId]);

    console.log(`🟢 [${requestId}] FOUND ${coursesResult.rows.length} ASSIGNED COURSES`);

    // For each course, calculate completion percentage
    const coursesWithProgress = await Promise.all(coursesResult.rows.map(async (course) => {
      try {
        const summary = await calculateCourseProgressSummary(req.user.userId, course.id);
        const overall = summary.overall;

        return {
          ...course,
          total_questions: overall.total_questions,
          correct_answers: overall.total_score,
          total_attempted: overall.total_attempted,
          sections_completed: overall.sections_completed,
          total_sections: overall.total_sections,
          completion_percentage: overall.overall_percentage,
          progress_percentage: overall.progress_percentage
        };
      } catch (summaryError) {
        console.error(`⚠️ [${requestId}] Failed to compute progress summary for course ${course.id}:`, summaryError.message);
        return {
          ...course,
          total_questions: 0,
          correct_answers: 0,
          total_attempted: 0,
          sections_completed: 0,
          total_sections: 0,
          completion_percentage: 0,
          progress_percentage: 0
        };
      }
    }));

    res.json(coursesWithProgress);

  } catch (error) {
    console.log(`💥 [${requestId}] GET COURSES ERROR:`, error.message);
    res.status(500).json({ 
      error: 'Failed to load courses', 
      details: error.message,
      requestId: requestId
    });
  }
});

// Test endpoint to check database content
app.get('/api/debug/course-sections', async (req, res) => {
  try {
    console.log('🔍 DEBUG: Checking course sections...');
    
    // Check if course_sections table exists and has data
    const sectionsResult = await db.query(`
      SELECT cs.*, c.name as course_name
      FROM course_sections cs
      LEFT JOIN courses c ON cs.course_id = c.id
      ORDER BY cs.course_id, cs.section_number
    `);
    
    console.log('📊 Course sections found:', sectionsResult.rows.length);
    
    res.json({
      sections: sectionsResult.rows,
      count: sectionsResult.rows.length
    });
  } catch (error) {
    console.error('❌ Error checking course sections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check user_quiz_progress table structure
app.get('/api/debug/user-quiz-progress-schema', async (req, res) => {
  try {
    console.log('🔍 Checking user_quiz_progress table schema...');
    
    // Get table columns
    const columns = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'user_quiz_progress'
      ORDER BY ordinal_position
    `);
    
    console.log('📊 user_quiz_progress columns:', columns.rows);
    
    // Check if table has any data
    const dataCheck = await db.query(`SELECT COUNT(*) FROM user_quiz_progress`);
    console.log('📊 user_quiz_progress row count:', dataCheck.rows[0].count);
    
    res.json({
      columns: columns.rows,
      rowCount: dataCheck.rows[0].count
    });
  } catch (error) {
    console.error('💥 Error checking schema:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get section content from database
app.get('/api/section/:sectionId/content', authenticateToken, async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔍 [${requestId}] GET SECTION CONTENT REQUEST`);
  console.log(`   👤 User ID: ${req.user.userId}`);
  console.log(`   🎯 Section ID: ${req.params.sectionId}`);
  
  try {
    const sectionId = req.params.sectionId;
    
    console.log(`   🔄 Loading content for section ${sectionId}...`);
    
    const result = await db.query(`
      SELECT 
        sc.content_html,
        cs.section_name,
        cs.section_number
      FROM section_content sc
      JOIN course_sections cs ON cs.id = sc.section_id
      WHERE sc.section_id = $1 AND sc.active = true AND cs.active = true
    `, [sectionId]);
    
    if (result.rows.length === 0) {
      console.log(`   ❌ No content found for section ${sectionId}`);
      return res.status(404).json({ message: 'Section content not found' });
    }
    
    const content = result.rows[0];
    console.log(`   ✅ Found content for: ${content.section_name}`);
    
    // Disable caching for this endpoint
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json({
      sectionId: parseInt(sectionId),
      sectionName: content.section_name,
      sectionNumber: content.section_number,
      content: content.content_html
    });
    
  } catch (error) {
    console.error(`💥 [${requestId}] ERROR:`, error.message);
    console.error(`💥 [${requestId}] STACK:`, error.stack);
    res.status(500).json({ 
      message: 'Server error fetching section content',
      error: error.message,
      requestId: requestId
    });
  }
});

// Get course sections with progress
app.get('/api/course/:courseId/sections', authenticateToken, async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔍 [${requestId}] GET COURSE SECTIONS REQUEST`);
  console.log(`   👤 User ID: ${req.user.userId}`);
  console.log(`   🎯 Course ID: ${req.params.courseId}`);
  
  try {
    const userId = req.user.userId;
    const courseId = req.params.courseId;
    
    console.log(`   🔄 Executing query for course ${courseId}...`);
    const sections = await db.query(`
      SELECT 
        cs.id, 
        cs.section_name, 
        cs.section_number,
        0 as progress,
        false as is_completed
      FROM course_sections cs
      WHERE cs.course_id = $1 AND cs.active = true
      ORDER BY cs.section_number
    `, [courseId]);
    
    console.log(`✅ [${requestId}] FOUND ${sections.rows.length} SECTIONS`);
    sections.rows.forEach(section => {
      console.log(`   📚 Section ${section.section_number}: ${section.section_name} (ID: ${section.id})`);
    });
    
    // Disable caching for this endpoint
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json(sections.rows);
  } catch (error) {
    console.error(`💥 [${requestId}] ERROR:`, error.message);
    console.error(`💥 [${requestId}] STACK:`, error.stack);
    res.status(500).json({ 
      message: 'Server error fetching course sections',
      error: error.message,
      requestId: requestId
    });
  }
});

// Get quiz questions for a section
app.get('/api/section/:sectionId/quiz', authenticateToken, async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔍 [${requestId}] GET SECTION QUIZ REQUEST`);
  console.log(`   👤 User ID: ${req.user.userId}`);
  console.log(`   🎯 Section ID: ${req.params.sectionId}`);
  
  try {
    const userId = req.user.userId;
    const sectionId = req.params.sectionId;
    
    console.log(`   🔄 Finding quiz for section ${sectionId}...`);
    
    // Get quiz ID and section name for this section
    const quizResult = await db.query(`
      SELECT q.id, cs.section_name 
      FROM quizes q
      JOIN course_sections cs ON q.section_id = cs.id
      WHERE q.section_id = $1 AND q.active = true 
      LIMIT 1
    `, [sectionId]);
    
    if (quizResult.rows.length === 0) {
      console.log(`   ❌ No quiz found for section ${sectionId}`);
      return res.status(404).json({ message: 'Quiz not found for this section' });
    }
    
    const quizId = quizResult.rows[0].id;
    const sectionName = quizResult.rows[0].section_name;
    console.log(`   ✅ Found quiz ID: ${quizId}, Section: ${sectionName}`);
    
    console.log(`   🔄 Loading questions for quiz ${quizId}...`);
    
    // Get questions with choices
    const questions = await db.query(`
      SELECT 
        qq.id,
        qq.question_name,
        array_agg(
          json_build_object(
            'id', qmc.id,
            'choice_name', qmc.choice_name,
            'choice_description', qmc.choice_description,
            'is_correct', qmc.is_correct
          ) ORDER BY qmc.choice_name
        ) as choices
      FROM quiz_questions qq
      LEFT JOIN quiz_multiple_choices qmc ON qq.id = qmc.question_id AND qmc.active = true
      WHERE qq.quiz_id = $1 AND qq.active = true
      GROUP BY qq.id, qq.question_name
      ORDER BY qq.id
    `, [quizId]);
    
    console.log(`   ✅ Found ${questions.rows.length} questions`);
    
    // Load user's progress for this quiz
    let progress = {
      progress: 0,
      is_completed: false,
      current_question: 0,
      user_answers: {},
      score: 0
    };
    
    try {
      const progressResult = await db.query(`
        SELECT current_question, progress_percentage, user_answers, is_completed, score
        FROM user_quiz_progress_tracker
        WHERE user_id = $1 AND quiz_id = $2
      `, [userId, quizId]);
      
      if (progressResult.rows.length > 0) {
        const savedProgress = progressResult.rows[0];
        progress = {
          progress: savedProgress.progress_percentage || 0,
          is_completed: savedProgress.is_completed || false,
          current_question: savedProgress.current_question || 0,
          user_answers: savedProgress.user_answers || {},
          score: savedProgress.score || 0
        };
        console.log(`   📊 Loaded existing progress: ${progress.progress}% complete`);
      } else {
        console.log(`   📊 No existing progress found - starting fresh`);
      }
    } catch (error) {
      console.log(`   ⚠️ Could not load progress (using defaults): ${error.message}`);
    }
    
    console.log(`   ✅ Returning quiz data`);
    
    res.json({
      quizId: quizId,
      sectionName: sectionName,
      questions: questions.rows,
      progress: progress
    });
    
  } catch (error) {
    console.error(`💥 [${requestId}] ERROR:`, error.message);
    console.error(`💥 [${requestId}] STACK:`, error.stack);
    res.status(500).json({ 
      message: 'Server error fetching quiz',
      error: error.message,
      requestId: requestId
    });
  }
});

// Reset quiz progress for retaking
app.post('/api/quiz/:quizId/reset', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const quizId = req.params.quizId;
    
    console.log(`🔄 [RESET] Resetting quiz ${quizId} for user ${userId}`);
    
    // Reset the progress tracker
    await db.query(`
      UPDATE user_quiz_progress_tracker 
      SET 
        current_question = 0,
        progress_percentage = 0,
        user_answers = '{}',
        is_completed = false,
        score = 0,
        modified_on = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND quiz_id = $2
    `, [userId, quizId]);
    
    console.log(`✅ [RESET] Quiz progress reset successfully`);
    
    res.json({ 
      success: true,
      message: 'Quiz progress reset successfully'
    });
    
  } catch (error) {
    console.error('💥 Error resetting quiz progress:', error);
    res.status(500).json({ message: 'Server error resetting quiz progress', details: error.message });
  }
});

// Save quiz progress
app.post('/api/quiz/:quizId/progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const quizId = req.params.quizId;
    const { currentQuestion, userAnswers, progress, isCompleted } = req.body;
    
    console.log(`💾 [PROGRESS] Saving quiz progress for user ${userId}, quiz ${quizId}`);
    console.log(`   📊 Progress: ${progress}%, Question: ${currentQuestion}, Completed: ${isCompleted}`);
    
    // Get user assigned course ID
    const courseResult = await db.query(`
      SELECT uac.id FROM user_assigned_courses uac
      JOIN quizes q ON q.course_id = uac.course_id
      WHERE uac.user_id = $1 AND q.id = $2 AND uac.active = true
    `, [userId, quizId]);
    
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ message: 'User course assignment not found' });
    }
    
    const userAssignedCourseId = courseResult.rows[0].id;
    
    // Get total questions for this quiz
    const totalQuestionsResult = await db.query(`
      SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = $1 AND active = true
    `, [quizId]);
    const totalQuestions = parseInt(totalQuestionsResult.rows[0].count);
    
    // Calculate current score by comparing user answers to correct answers
    let currentScore = 0;
    if (userAnswers && Object.keys(userAnswers).length > 0) {
      const correctAnswersResult = await db.query(`
        SELECT qq.id, (ROW_NUMBER() OVER (ORDER BY qq.id) - 1) as array_index, qmc.choice_name as correct_answer
        FROM quiz_questions qq
        JOIN quiz_multiple_choices qmc ON qq.id = qmc.question_id
        WHERE qq.quiz_id = $1 AND qq.active = true AND qmc.is_correct = true
        ORDER BY qq.id
      `, [quizId]);
      
      correctAnswersResult.rows.forEach((correctAnswer) => {
        // Try both question ID and array index formats for backward compatibility
        const userAnswerById = userAnswers[correctAnswer.id.toString()];
        const userAnswerByIndex = userAnswers[correctAnswer.array_index.toString()];
        const userAnswer = userAnswerById || userAnswerByIndex;
        
        if (userAnswer && userAnswer === correctAnswer.correct_answer) {
          currentScore++;
        }
      });
    }
    
    console.log(`📊 [PROGRESS] Current score calculated: ${currentScore}/${Object.keys(userAnswers || {}).length} answered correctly`);
    
    // Upsert progress
    await db.query(`
      INSERT INTO user_quiz_progress_tracker 
      (user_id, quiz_id, user_assigned_course_id, current_question, total_questions, progress_percentage, user_answers, is_completed, score)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, quiz_id) 
      DO UPDATE SET 
        current_question = $4,
        total_questions = $5,
        progress_percentage = $6,
        user_answers = $7,
        is_completed = $8,
        score = $9,
        modified_on = CURRENT_TIMESTAMP
    `, [userId, quizId, userAssignedCourseId, currentQuestion, totalQuestions, progress, JSON.stringify(userAnswers), isCompleted, currentScore]);
    
    console.log(`✅ [PROGRESS] Progress saved successfully`);
    res.json({ message: 'Progress saved successfully' });
    
  } catch (error) {
    console.error('💥 Error saving quiz progress:', error);
    res.status(500).json({ message: 'Server error saving progress', details: error.message });
  }
});

// Reset quiz progress (for retake functionality)
app.delete('/api/quiz/:quizId/progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const quizId = req.params.quizId;
    
    console.log(`🔄 [RETAKE] Resetting quiz progress for user ${userId}, quiz ${quizId}`);
    
    // Delete the quiz progress record
    const deleteResult = await db.query(`
      DELETE FROM user_quiz_progress_tracker 
      WHERE user_id = $1 AND quiz_id = $2
      RETURNING *
    `, [userId, quizId]);
    
    if (deleteResult.rows.length > 0) {
      console.log(`✅ [RETAKE] Successfully reset quiz ${quizId} for user ${userId}`);
      res.json({ 
        success: true, 
        message: 'Quiz progress reset successfully',
        resetQuiz: quizId
      });
    } else {
      console.log(`ℹ️ [RETAKE] No progress found to reset for quiz ${quizId}, user ${userId}`);
      res.json({ 
        success: true, 
        message: 'No progress to reset',
        resetQuiz: quizId
      });
    }
    
  } catch (error) {
    console.error('❌ [RETAKE] Error resetting quiz progress:', error);
    res.status(500).json({ error: 'Failed to reset quiz progress' });
  }
});

// Form-based quiz reset for Simple Browser compatibility
app.post('/api/quiz/:quizId/reset', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const quizId = req.params.quizId;
    
    console.log(`🔄 [RETAKE-FORM] Resetting quiz progress for user ${userId}, quiz ${quizId}`);
    
    // Delete the quiz progress record
    const deleteResult = await db.query(`
      DELETE FROM user_quiz_progress_tracker 
      WHERE user_id = $1 AND quiz_id = $2
      RETURNING *
    `, [userId, quizId]);
    
    console.log(`✅ [RETAKE-FORM] Successfully reset quiz ${quizId} for user ${userId}`);
    
    // Redirect back to main page with success message
    res.redirect('/?message=Quiz reset successfully');
    
  } catch (error) {
    console.error('❌ [RETAKE-FORM] Error resetting quiz progress:', error);
    res.redirect('/?error=Failed to reset quiz');
  }
});

// Submit quiz results
app.post('/api/quiz/:quizId/submit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const quizId = req.params.quizId;
    const { userAnswers, score, totalQuestions } = req.body;
    
    console.log(`🎯 [SUBMIT] Submitting quiz results for user ${userId}, quiz ${quizId}`);
    console.log(`   📊 Score: ${score}/${totalQuestions} (${Math.round((score / totalQuestions) * 100)}%)`);
    
    // Get actual total questions for this quiz from database
    const totalQuestionsResult = await db.query(`
      SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = $1 AND active = true
    `, [quizId]);
    const actualTotalQuestions = parseInt(totalQuestionsResult.rows[0].count);
    
    console.log(`📊 [SUBMIT] Actual total questions in DB: ${actualTotalQuestions}, User submitted: ${totalQuestions}`);
    
    // Get user assigned course ID
    const courseResult = await db.query(`
      SELECT uac.id FROM user_assigned_courses uac
      JOIN quizes q ON q.course_id = uac.course_id
      WHERE uac.user_id = $1 AND q.id = $2 AND uac.active = true
    `, [userId, quizId]);
    
    const userAssignedCourseId = courseResult.rows[0]?.id;
    if (!userAssignedCourseId) {
      return res.status(404).json({ message: 'User course assignment not found' });
    }
    
    const scorePercentage = actualTotalQuestions > 0 ? (score / actualTotalQuestions * 100).toFixed(2) : 0;
    const passed = scorePercentage >= 70; // Assuming 70% pass rate

    // Update progress tracker with final score and completion
    try {
      await db.query(`
        INSERT INTO user_quiz_progress_tracker 
        (user_id, quiz_id, user_assigned_course_id, current_question, total_questions, progress_percentage, user_answers, is_completed, score)
        SELECT $1, $2, uac.id, $4, $4, 100, $6::jsonb, true, $3
        FROM user_assigned_courses uac
        JOIN quizes q ON q.course_id = uac.course_id
        WHERE uac.user_id = $1 AND q.id = $2 AND uac.active = true
        ON CONFLICT (user_id, quiz_id) 
        DO UPDATE SET 
          score = $3,
          is_completed = true,
          progress_percentage = 100,
          current_question = $4,
          total_questions = $4,
          user_answers = $6::jsonb,
          modified_on = CURRENT_TIMESTAMP
      `, [userId, quizId, score, actualTotalQuestions, actualTotalQuestions, JSON.stringify(userAnswers)]);
    } catch (trackerError) {
      console.error(`⚠️ [SUBMIT] Progress tracker update failed:`, trackerError.message);
      // Try simple update if record exists
      await db.query(`
        UPDATE user_quiz_progress_tracker 
        SET score = $3, is_completed = true, progress_percentage = 100, current_question = $4, 
            total_questions = $4, user_answers = $5::jsonb, modified_on = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND quiz_id = $2
      `, [userId, quizId, score, actualTotalQuestions, JSON.stringify(userAnswers)]);
    }
    
    console.log(`✅ [SUBMIT] Quiz results saved successfully`);
    
    const percentage = Math.round((score / actualTotalQuestions) * 100);
    res.json({ 
      message: 'Quiz results submitted successfully',
      score: score,
      totalQuestions: actualTotalQuestions,
      percentage: percentage,
      passed: percentage >= 80
    });
    
  } catch (error) {
    console.error('💥 Error submitting quiz results:', error);
    res.status(500).json({ message: 'Server error submitting results', details: error.message });
  }
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    env: {
      mailgunDomain: process.env.MAILGUN_DOMAIN ? 'configured' : 'missing',
      mailgunApiKey: process.env.MAILGUN_API_KEY ? 'configured' : 'missing',
      recipientEmail: process.env.RECIPIENT_EMAIL || 'using default'
    }
  });
});

// Email endpoint that uses server-side environment variables
app.post('/api/send-email', async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n🔵 [${requestId}] EMAIL REQUEST STARTED`);
  console.log(`   📧 Subject: ${req.body.subject || 'No subject'}`);
  console.log(`   📄 HTML Content: ${req.body.htmlContent ? req.body.htmlContent.length + ' characters' : 'Not provided'}`);
  console.log(`   📝 Text Content: ${req.body.textContent ? req.body.textContent.length + ' characters' : 'Not provided'}`);
  
  try {
    const { htmlContent, textContent, subject } = req.body;

    // Get environment variables (secure server-side access)
    const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
    const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
    const MAILGUN_API_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;
    const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'info@brooklyncdl.com';
    
    console.log(`   🌐 Using Mailgun Domain: ${MAILGUN_DOMAIN}`);
    console.log(`   📮 Sending to Recipient: ${RECIPIENT_EMAIL}`);
    console.log(`   🔗 API URL: ${MAILGUN_API_URL}`);
    console.log(`   🔑 API Key Status: ${MAILGUN_API_KEY ? 'Present (' + MAILGUN_API_KEY.substring(0, 8) + '...)' : 'Missing!'}`);

    // Validate required environment variables
    if (!MAILGUN_DOMAIN || !MAILGUN_API_KEY) {
      console.log(`❌ [${requestId}] VALIDATION FAILED - Missing environment variables`);
      console.log(`   Domain present: ${!!MAILGUN_DOMAIN}`);
      console.log(`   API Key present: ${!!MAILGUN_API_KEY}`);
      return res.status(500).json({ 
        error: 'Missing Mailgun configuration. Please check environment variables.',
        requestId: requestId
      });
    }

    console.log(`✅ [${requestId}] Environment validation passed`);

    // Create form data for Mailgun API
    const formData = new FormData();
    formData.append('from', `Brooklyn CDL ELDT <postmaster@${MAILGUN_DOMAIN}>`);
    formData.append('to', RECIPIENT_EMAIL);
    formData.append('subject', subject || 'ELDT Score Submission');
    formData.append('html', htmlContent);
    formData.append('text', textContent);

    // Send email via Mailgun
    console.log(`📤 [${requestId}] Sending request to Mailgun API...`);
    console.log(`   📍 URL: ${MAILGUN_API_URL}`);
    console.log(`   👤 From: Brooklyn CDL ELDT <postmaster@${MAILGUN_DOMAIN}>`);
    console.log(`   👤 To: ${RECIPIENT_EMAIL}`);
    console.log(`   📋 Subject: ${subject || 'ELDT Score Submission'}`);
    
    const startTime = Date.now();
    const response = await fetch(MAILGUN_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
        ...formData.getHeaders()
      },
      body: formData
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`⏱️ [${requestId}] Mailgun API response received in ${responseTime}ms`);
    console.log(`   📊 Status Code: ${response.status}`);
    console.log(`   📊 Status Text: ${response.statusText}`);

    if (response.ok) {
      const result = await response.json();
      console.log(`🟢 [${requestId}] EMAIL SENT SUCCESSFULLY!`);
      console.log(`   📬 Mailgun Message ID: ${result.id || 'N/A'}`);
      console.log(`   📝 Full Response:`, JSON.stringify(result, null, 2));
      res.json({ 
        success: true, 
        message: 'Email sent successfully!', 
        data: result,
        requestId: requestId
      });
    } else {
      const error = await response.text();
      console.log(`🔴 [${requestId}] MAILGUN API ERROR`);
      console.log(`   📊 Status: ${response.status} - ${response.statusText}`);
      console.log(`   📄 Error Details:`, error);
      
      // Try to parse error as JSON for better logging
      try {
        const errorObj = JSON.parse(error);
        console.log(`   🔍 Parsed Error:`, JSON.stringify(errorObj, null, 2));
      } catch (e) {
        console.log(`   🔍 Raw Error Text: ${error}`);
      }
      
      res.status(400).json({ 
        success: false, 
        error: 'Failed to send email', 
        details: error,
        requestId: requestId
      });
    }

  } catch (error) {
    console.log(`💥 [${requestId}] SERVER ERROR OCCURRED`);
    console.log(`   🔍 Error Type: ${error.constructor.name}`);
    console.log(`   💬 Error Message: ${error.message}`);
    console.log(`   📍 Stack Trace:`);
    console.log(error.stack);
    
    // Additional context for common errors
    if (error.code) {
      console.log(`   🔧 Error Code: ${error.code}`);
    }
    if (error.errno) {
      console.log(`   🔧 Error Number: ${error.errno}`);
    }
    if (error.syscall) {
      console.log(`   🔧 System Call: ${error.syscall}`);
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Server error sending email', 
      details: error.message,
      requestId: requestId
    });
  }
});

// Save results endpoint - saves HTML content to file
app.post('/api/saveResults', async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n💾 [${requestId}] SAVE RESULTS REQUEST STARTED`);
  
  try {
    const { htmlContent, licenseNumber, state, firstName, lastName } = req.body;
    
    console.log(`   📄 Content Length: ${htmlContent ? htmlContent.length + ' characters' : 'Not provided'}`);
    console.log(`   📝 License Number: ${licenseNumber || 'Not provided'}`);
    console.log(`   🏛️ State: ${state || 'Not provided'}`);
    console.log(`   👤 Name: ${firstName || 'N/A'} ${lastName || 'N/A'}`);

    // Validate required fields
    if (!htmlContent || !licenseNumber || !state || !firstName || !lastName) {
      console.log(`❌ [${requestId}] VALIDATION FAILED - Missing required fields`);
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: htmlContent, licenseNumber, state, firstName, lastName',
        requestId: requestId
      });
    }

    // Create filename: results.$licenseNumber.$firstName.$lastName.$state.YYYYMMDD.hhmmss.html
    const sanitizedFirstName = firstName.replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedLastName = lastName.replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedLicenseNumber = licenseNumber.replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedState = state.replace(/[^a-zA-Z0-9]/g, '');
    
    // Create date timestamp: YYYYMMDD.hhmmss
    const now = new Date();
    const dateStamp = now.getFullYear().toString() + 
                     (now.getMonth() + 1).toString().padStart(2, '0') + 
                     now.getDate().toString().padStart(2, '0');
    const timeStamp = now.getHours().toString().padStart(2, '0') + 
                     now.getMinutes().toString().padStart(2, '0') + 
                     now.getSeconds().toString().padStart(2, '0');
    const timestamp = `${dateStamp}.${timeStamp}`;
    
    const filename = `results.${sanitizedLicenseNumber}.${sanitizedFirstName}.${sanitizedLastName}.${sanitizedState}.${timestamp}.html`;
    const filePath = path.join(__dirname, 'results', filename);
    
    console.log(`   📁 Filename: ${filename}`);
    console.log(`   📍 Full Path: ${filePath}`);

    // Ensure results directory exists
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
      console.log(`   📁 Creating results directory: ${resultsDir}`);
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Write HTML content to file
    console.log(`   💾 Writing file...`);
    const startTime = Date.now();
    
    fs.writeFileSync(filePath, htmlContent, 'utf8');
    
    const writeTime = Date.now() - startTime;
    console.log(`   ⏱️ File written in ${writeTime}ms`);
    console.log(`   📊 File size: ${fs.statSync(filePath).size} bytes`);
    console.log(`🟢 [${requestId}] FILE SAVED SUCCESSFULLY!`);

    res.json({
      success: true,
      message: 'Results saved successfully!',
      filename: filename,
      filePath: filePath,
      fileSize: fs.statSync(filePath).size,
      requestId: requestId
    });

  } catch (error) {
    console.log(`💥 [${requestId}] SERVER ERROR OCCURRED`);
    console.log(`   🔍 Error Type: ${error.constructor.name}`);
    console.log(`   💬 Error Message: ${error.message}`);
    console.log(`   📍 Stack Trace:`);
    console.log(error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Server error saving results',
      details: error.message,
      requestId: requestId
    });
  }
});

// Submit final results to Results table
app.post('/api/submit-final-results', authenticateToken, async (req, res) => {
  const requestId = Date.now().toString(36);
  console.log(`\n📊 [${requestId}] SUBMIT FINAL RESULTS REQUEST`);
  console.log(`   👤 User ID: ${req.user.userId}`);
  
  try {
    const { courseId, totalScore, totalPossible, scorePercentage, passed } = req.body;
    
    console.log(`   📚 Course ID: ${courseId}`);
    console.log(`   📊 Score: ${totalScore}/${totalPossible} (${scorePercentage}%)`);
    console.log(`   ✅ Passed: ${passed}`);
    
    // Validate required fields
    if (courseId === undefined || totalScore === undefined || totalPossible === undefined || 
        scorePercentage === undefined || passed === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        requestId: requestId
      });
    }
    
    // Get user_assigned_course_id
    const userCourseResult = await db.query(`
      SELECT id FROM user_assigned_courses 
      WHERE user_id = $1 AND course_id = $2 AND active = true
    `, [req.user.userId, courseId]);
    
    if (userCourseResult.rows.length === 0) {
      console.log(`❌ [${requestId}] User course assignment not found`);
      return res.status(404).json({
        success: false,
        error: 'User course assignment not found',
        requestId: requestId
      });
    }
    
    const userAssignedCourseId = userCourseResult.rows[0].id;
    
    // Insert into Results table
    const resultInsert = await db.query(`
      INSERT INTO results 
      (user_assigned_course_id, total_score, total_possible, score_percentage, passed, submitted_on)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id, submitted_on
    `, [userAssignedCourseId, totalScore, totalPossible, scorePercentage, passed]);
    
    const resultId = resultInsert.rows[0].id;
    const submittedOn = resultInsert.rows[0].submitted_on;
    
    console.log(`🟢 [${requestId}] RESULTS SAVED TO DATABASE`);
    console.log(`   📋 Result ID: ${resultId}`);
    console.log(`   📅 Submitted: ${submittedOn}`);
    
    res.json({
      success: true,
      message: 'Final results submitted successfully',
      resultId: resultId,
      submittedOn: submittedOn,
      requestId: requestId
    });
    
  } catch (error) {
    console.log(`💥 [${requestId}] ERROR:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Server error submitting final results',
      details: error.message,
      requestId: requestId
    });
  }
});

// Get overall or course-specific progress summary
app.get('/api/user/course-progress', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const requestedCourseId = parseInt(req.query.courseId, 10);
    const courseId = Number.isFinite(requestedCourseId) ? requestedCourseId : 1;

    console.log(`📊 [PROGRESS] Fetching course ${courseId} progress for user ${userId}`);

    const summary = await calculateCourseProgressSummary(userId, courseId);
    res.json(summary);
  } catch (error) {
    console.error('💥 Error getting course progress:', error);
    res.status(500).json({ message: 'Server error getting progress', details: error.message });
  }
});

// Dashboard info endpoint for user timeline/payment placeholders
app.get('/api/user/dashboard-info', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log(`📊 [DASHBOARD] Loading timeline data for user ${userId}`);

    const userDetails = await db.query(
      `SELECT registration_date FROM users WHERE id = $1`,
      [userId]
    );

    const lastQuizResult = await db.query(
      `SELECT MAX(modified_on) AS last_quiz_date
       FROM user_quiz_progress_tracker
       WHERE user_id = $1`,
      [userId]
    );

    const submissionResult = await db.query(
      `SELECT r.submitted_on
       FROM results r
       JOIN user_assigned_courses uac ON r.user_assigned_course_id = uac.id
       WHERE uac.user_id = $1
       ORDER BY r.submitted_on DESC
       LIMIT 1`,
      [userId]
    );

    res.json({
      registrationDate: userDetails.rows[0]?.registration_date || null,
      lastQuizDate: lastQuizResult.rows[0]?.last_quiz_date || null,
      submissionDate: submissionResult.rows[0]?.submitted_on || null
    });
  } catch (error) {
    console.error('💥 Error loading dashboard info:', error);
    res.status(500).json({ message: 'Server error loading dashboard info', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Mailgun Domain: ${process.env.MAILGUN_DOMAIN || 'Not configured'}`);
  console.log(`Mailgun API Key: ${process.env.MAILGUN_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`Recipient Email: ${process.env.RECIPIENT_EMAIL || 'Using default: info@brooklyncdl.com'}`);
});

module.exports = {
  app,
  calculateCourseProgressSummary
};

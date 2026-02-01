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
const PORT = process.env.PORT || 3000;
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

async function ensureProgressTrackerTable() {
  await db.query(`
      CREATE TABLE IF NOT EXISTS user_quiz_progress_tracker (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        quiz_id INTEGER REFERENCES quizes(id) ON DELETE CASCADE,
        user_assigned_course_id INTEGER REFERENCES user_assigned_courses(id) ON DELETE CASCADE,
        current_question INTEGER DEFAULT 0,
        total_questions INTEGER DEFAULT 0,
        progress_percentage INTEGER DEFAULT 0,
        user_answers JSONB DEFAULT '{}',
        is_completed BOOLEAN DEFAULT FALSE,
        score INTEGER DEFAULT 0,
        modified_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, quiz_id)
      )
    `);
}

async function calculateCourseProgressSummary(userId, courseId) {
  if (!courseId) {
    throw new Error('courseId is required to calculate progress');
  }

  await ensureProgressTrackerTable();

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

// Initialize course sections if they don't exist
app.post('/api/debug/init-course-sections', async (req, res) => {
  try {
    console.log('🔄 Initializing course sections...');
    
    // Check if sections already exist
    const existingSections = await db.query('SELECT COUNT(*) FROM course_sections WHERE course_id = 1');
    const count = parseInt(existingSections.rows[0].count);
    
    if (count > 0) {
      return res.json({ message: 'Course sections already exist', count });
    }
    
    // Insert the 5 course sections
    const sections = [
      { id: 1, name: 'Basic Operation', section_number: 1 },
      { id: 2, name: 'Safe Operating Procedures', section_number: 2 },
      { id: 3, name: 'Advanced Operating Practices', section_number: 3 },
      { id: 4, name: 'Vehicle Systems & Malfunctions', section_number: 4 },
      { id: 5, name: 'Non-Driving Activities', section_number: 5 }
    ];
    
    for (const section of sections) {
      await db.query(`
        INSERT INTO course_sections (id, course_id, section_name, section_number, active)
        VALUES ($1, 1, $2, $3, true)
        ON CONFLICT (id) DO UPDATE SET
          section_name = $2,
          section_number = $3,
          active = true
      `, [section.id, section.name, section.section_number]);
    }
    
    console.log('✅ Course sections initialized');
    res.json({ message: 'Course sections initialized successfully', sections });
    
  } catch (error) {
    console.error('❌ Error initializing course sections:', error);
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

// Initialize section content table and data
async function initializeSectionContent() {
  try {
    console.log('🔄 Initializing section content table...');
    
    // Create section_content table
    await db.query(`
      CREATE TABLE IF NOT EXISTS section_content (
        id SERIAL PRIMARY KEY,
        section_id INTEGER NOT NULL REFERENCES course_sections(id),
        content_html TEXT NOT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        modified_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        modified_by VARCHAR(100) DEFAULT 'system',
        active BOOLEAN DEFAULT true,
        UNIQUE(section_id)
      )
    `);
    
    console.log('✅ Section content table created/verified');
    
    // Check if content already exists
    const existingContent = await db.query('SELECT COUNT(*) FROM section_content WHERE active = true');
    
    if (existingContent.rows[0].count > 0) {
      console.log('📚 Section content already exists, skipping initialization');
      return;
    }
    
    console.log('📝 Inserting section content...');
    
    // Insert content for each section
    const sectionContents = [
      {
        section_id: 1,
        content_html: `<h2>Basic Operation</h2>

<p>Welcome to the foundational section of your Class A CDL training. This section covers essential knowledge and skills that every professional commercial driver must master to operate safely and comply with federal regulations.</p>

<div class="highlight-box">
  <strong>Course Requirement:</strong> You must complete all lessons with at least 80% proficiency to successfully pass this ELDT training and qualify for your CDL exam.
</div>

<h3>1. Driver Responsibility and Safety Standards</h3>

<p>As a commercial driver, you bear the ultimate responsibility for the safety of your vehicle, cargo, and everyone on the road. This responsibility cannot be delegated to loaders, mechanics, or dispatchers. You are the final authority on whether your vehicle is safe to operate.</p>

<p>Driving a commercial motor vehicle is a serious responsibility because it involves the safety of lives and cargo. The Federal Motor Carrier Safety Regulations (FMCSRs) and Hazardous Materials Regulations (HMRs) establish minimum safety standards for trucking operations. These are not optional guidelines but legally enforceable requirements that protect you and the public.</p>

<div class="warning-box">
  <strong>Important:</strong> Vehicle size and weight limits differ depending on the state. Always verify state-specific requirements before operating across state lines.
</div>

<h3>2. Pre-Trip Inspection</h3>

<p>The pre-trip inspection is your first line of defense against mechanical failures and accidents. This systematic check helps identify defects that could cause crashes, breakdowns, or regulatory violations.</p>

<p><strong>Why Pre-Trip Inspections Matter:</strong></p>
<ul>
  <li>Identify safety hazards before they cause accidents</li>
  <li>Prevent costly breakdowns on the road</li>
  <li>Comply with FMCSA regulations</li>
  <li>Pass roadside inspections</li>
  <li>Extend vehicle life through early problem detection</li>
</ul>

<div class="success-box">
  <strong>Critical Inspection Items:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li><strong>Oil/Coolant/Power Steering Levels:</strong> Check during pre-trip to prevent engine damage. Low oil can cause catastrophic engine failure. Low coolant may cause engine to overheat</li>
    <li><strong>Cuts/Abrasions/Leaks:</strong> Check hoses, pipes, tanks, reservoirs, harness for cuts, damages, abrasions, bulges and leaks (power steering fluid, coolant, air leaks, hydraulic leaks, etc.) </li>
    <li><strong>Tires/wheels</strong> Front tires tread dept > 4/32" & no recap (back tires > 2/32"), tire types/pressure; check for buldges, air leaks, tight lug nuts, hub/axle seal leaks, mud flaps, debris, etc.</li>
    <li><strong>Brakes</strong> Brake lining thickness > 1/4 inch, no oil/grease between drums and linings, push road free play < 1 inch when brakes released, no air leaks in brake chambers/hoses, no ABS wire cuts</li>
    <li><strong>Suspension:</strong> Check for missing leaf springs, damaged/leaking shock absorbers, broken hangers/u-bolts, deflated air springs, etc.</li>
    <li><strong>Steering:</strong> Check for lose steering shaft (< 2 inch of free play), broken, bend steering linkage, leaking pump, gear box, etc. </li>
    <li><strong>Gear/Belt driven components/Driving:</strong> Check for belt free play (< 3/4 inch), see no cracks, leaks or damages to air compressor, steering pump, alternator, A/C compressors, water pump, etc. </li>
    <li><strong>Exhaust and Drive shaft:</strong> Check exhaust system for black sooth, holes, damages. Check drive shaft for no bends, dents, proper u-joint connectors </li>
    <li><strong>Coupling:</strong> Check for air and electrical hoses, 5th wheel components </li>
    <li><strong>Unusual Signs:</strong> If you notice unusual sounds, smells, or vibrations while driving, stop and check immediately. These are warning signs of potential failures.</li>
  </ul>
</div>

<h3>3. Brake Systems and Air Pressure</h3>

<p>Your brake system is the most critical safety component on your vehicle. Understanding how it works and how to test it properly can save lives.</p>

<p><strong>Service Brakes:</strong> The service brake is your primary braking system. It's what you use for normal stopping under all driving conditions.</p>

<p><strong>Air Brake Testing:</strong></p>
<ul>
	<li>Air brake tests are essential for the safety: perform air leak test, low air pressure warning and spring emergency tests, parking and service brakes tests</li>
  <li>Air pressure should build from 50 to 90 PSI in approximately 3 minutes</li>
  <li>For hydraulic brakes, hold the pedal for 5 seconds during testing</li>
  <li>Pulling the trailer brake lever harder does NOT increase trailer braking force</li>
  <li>If the ABS light stays on, your ABS is not working properly and needs immediate attention</li>
</ul>

<h3>4. Gauges and Instrument Panel</h3>

<p>Your dashboard gauges provide real-time information about your vehicle's systems. Understanding what each gauge monitors helps you detect problems early.</p>

<ul>
	<li><strong>Warning Lights:</strong> Always investigate illuminated warning lights immediately</li>
  <li><strong>Temperature Gauges:</strong> Monitor engine coolant and oil temperatures</li>
  <li><strong>Pressure Gauges:</strong> Monitor engine and transmission pressure</li>
  <li><strong>Tachometer/Speedometer Gauges:</strong> Monitor engine rev and speed</li>
  <li><strong>Fuel Gauges:</strong> Monitor fuel levels such as diesel, DEF, etc.</li>
  <li><strong>Voltagmeter/Amperemeter Gauges:</strong> Shows the electrical system's operating voltages and current</li>
  <li><strong>Air Pressure Gauges:</strong> Primary and Secondary: critical for air brake-equipped vehicles</li>
</ul>

<h3>5. Visibility and Mirror Adjustment</h3>

<p>Proper visibility is essential for safe operation of large commercial vehicles. Before every trip, ensure maximum visibility by properly adjusting your seating position and mirrors.</p>

<div class="highlight-box">
  <strong>Mirror and Visibility Checklist:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Adjust seat for optimal reach and visibility</li>
    <li>Position mirrors to minimize blind spots</li>
    <li>Keep mirrors and windshield clean at all times</li>
    <li>During turns, continuously watch the rear of your trailer in mirrors</li>
  </ul>
</div>

<h3>6. Bridge Clearances and Road Hazards</h3>

<p>Commercial vehicles face unique challenges related to height and weight restrictions. Low bridge signs may be inaccurate, so always know your vehicle height and add a safety margin. The bridge weight formula was created specifically to protect older bridges from overloading.</p>

<h3>7. Backing Procedures</h3>

<p>Backing is one of the most dangerous maneuvers in trucking and should be avoided whenever possible because it significantly increases accident risk.</p>

<p><strong>Safe Backing Practices:</strong></p>
<ul>
  <li><strong>Starting Position:</strong> Your starting position matters critically for successful backing</li>
  <li><strong>G.O.A.L. (Get Out And Look):</strong> Always get out and look before backing to verify your path is clear</li>
  <li><strong>Blind Side Backing:</strong> More dangerous because visibility is severely reduced</li>
  <li><strong>Spotters:</strong> Using a spotter is helpful, but remember you remain responsible for the maneuver</li>
  <li><strong>Speed:</strong> Always use the lowest reverse gear when backing</li>
  <li><strong>Final Check:</strong> Be 100% sure nothing is behind you before beginning to back</li>
</ul>

<h3>8. Transmission and Shifting Techniques</h3>

<p>Proper shifting technique is crucial for preventing equipment damage and maintaining control of your vehicle, especially with non-synchronized transmissions common in heavy trucks.</p>

<p><strong>Non-Synced Transmission Techniques:</strong></p>
<ul>
  <li>Press clutch only 2-3 inches (not to the floor) when shifting</li>
  <li>If you miss a gear, release the clutch and try again - don't keep it pressed</li>
  <li>When downshifting, drop RPM to approximately 700 before shifting to neutral</li>
  <li>Master proper shifting to prevent transmission wear and damage</li>
</ul>

<h3>9. Interstate and Space Management</h3>

<p>Highway driving requires constant vigilance despite the seemingly simple straight roads. On the interstate, you must stay alert and continuously scan ahead for hazards. Never relax your attention.</p>

<p>In tight areas, always have an exit strategy planned. Know where you can go if you need to avoid a hazard quickly.</p>

<h3>10. Cargo Inspection Schedule</h3>

<p>After starting your trip, perform your first cargo inspection at 50 miles. This early check ensures your load hasn't shifted and all securement devices remain properly tensioned after initial road vibration and settling.</p>

<h3>11. Coupling and Uncoupling Procedures</h3>

<p>Coupling and uncoupling a tractor-trailer requires careful attention to safety procedures. Different rigs may have different specific procedures, so always follow the manufacturer's guidelines for your equipment.</p>

<div class="warning-box">
  <strong>Critical Coupling Safety Steps:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Before coupling: Inspect the area and chock wheels</li>
    <li>When backing under trailer: Use lowest reverse gear, back slowly, stop when kingpin locks</li>
    <li>Visually inspect the coupling to ensure it is secure</li>
    <li>Check both electrical cord AND air lines for proper connection</li>
    <li>Check trailer clearance after raising landing gear to avoid damage</li>
    <li>Final step: Remove wheel chocks before departure</li>
  </ul>
</div>

<div class="warning-box">
  <strong>Critical Uncoupling Safety Steps:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Before unlocking fifth wheel: Position rig correctly AND ease pressure on locking jaws</li>
    <li>Chock trailer wheels if it has no spring brakes</li>
    <li>Keep your feet clear of tractor wheels when unlocking fifth wheel (crush hazard)</li>
    <li>Keep tractor under trailer until landing gear is confirmed stable</li>
    <li>Secure the tractor before inspecting trailer supports</li>
    <li>When inspecting supports: Check both ground support AND landing gear condition</li>
    <li>Only after confirming landing gear is stable is it safe to pull tractor away</li>
  </ul>
</div>

<h3>12. Vehicle Size Considerations</h3>

<p>Wider vehicles have less room for error on roads and in tight spaces. Every inch matters when maneuvering large commercial vehicles. Extra width means reduced margins for error in lane positioning, turns, and parking.</p>

<div class="success-box">
  <strong>Key Takeaways for Section 1:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>You are responsible for vehicle and cargo safety</li>
    <li>Pre-trip inspections prevent accidents and breakdowns</li>
    <li>Proper brake testing can save lives</li>
    <li>Visibility and mirror adjustment are critical before every trip</li>
    <li>Backing should be minimized and performed with extreme caution</li>
    <li>Master shifting techniques to prevent equipment damage</li>
    <li>Coupling/uncoupling requires strict adherence to safety procedures</li>
    <li>Always maintain awareness of your vehicle's size and limitations</li>
  </ul>
</div>`
      },
      {
        section_id: 2,
        content_html: `<h2>Safe Operating Procedures</h2>

<p>This section focuses on the daily operational practices that keep you, your cargo, and other road users safe. Safe operating procedures encompass situational awareness, proper following distances, speed management, distracted driving prevention, and handling adverse conditions.</p>

<div class="highlight-box">
  <strong>Core Principle:</strong> Professional drivers must remain constantly aware of their surroundings and maintain safe operating practices in all conditions. A moment of inattention can result in injury or death to you or others.
</div>

<h3>1. Situational Awareness and Visual Scanning</h3>

<p>You should always be aware of your surroundings when driving a CMV. This isn't optional—it's a fundamental requirement for safe operation. Maintaining awareness means continuously scanning your environment, checking mirrors, and monitoring conditions ahead, beside, and behind your vehicle.</p>

<p><strong>How Far Ahead Should You Look?</strong></p>
<p>When driving a commercial vehicle, you should look 12-15 seconds ahead. This gives you adequate time to identify hazards, process information, and execute appropriate responses. At highway speeds, 12-15 seconds translates to approximately a quarter mile ahead.</p>

<h3>2. Mirror Use and Convex Mirror Properties</h3>

<p>Checking your mirrors regularly is essential—it is never acceptable to drive without checking your mirrors regularly, even on straight, empty roads. Conditions change rapidly, and vehicles can enter your space quickly.</p>

<div class="warning-box">
  <strong>Important Mirror Fact:</strong> Objects in convex mirrors appear further than they are. This optical effect helps eliminate blind spots but means vehicles are actually closer than they appear in these mirrors. Always account for this when changing lanes or merging.
</div>

<h3>3. Signaling and Communication</h3>

<p>Proper communication with other road users is critical for safety:</p>
<ul>
  <li><strong>Lane Changes:</strong> Signal and wait for traffic to clear before moving. Never signal and immediately move.</li>
  <li><strong>Hand Signals:</strong> It is not acceptable to wave your hands out the window to direct traffic, even in emergencies. Use proper signals and warning devices.</li>
  <li><strong>Headlights:</strong> Use headlights during the day when visibility is low to increase your visibility to other drivers.</li>
</ul>

<h3>4. Emergency Warning Devices</h3>

<p>When you must stop on the roadway or shoulder, you have 10 minutes to place emergency warning devices. This requirement protects you and warns other drivers.</p>

<p><strong>Standard Placement on Two-Way Highways:</strong></p>
<p>Place warning devices 10 feet from your vehicle and 100 feet ahead and behind your vehicle. If the view is obstructed (such as around curves or over hills), place the last device 100-500 feet back depending on the obstruction to give approaching drivers adequate warning.</p>

<h3>5. Distracted Driving</h3>

<p>Distracted driving is anything that takes your attention away from driving. This includes visual distractions (taking your eyes off the road), manual distractions (taking your hands off the wheel), and cognitive distractions (taking your mind off driving).</p>

<div class="danger-box" style="background: rgba(239, 68, 68, 0.15); border-left: 4px solid var(--danger); padding: 18px; margin: 20px 0; border-radius: 8px;">
  <strong>Critical Safety Fact:</strong> If you are not focused while operating a CMV, the likely outcome is injury or death to you or others. Professional drivers must always pull over before checking a mobile device. To be a professional driver, you must stay focused and avoid distractions at all times.
</div>

<p>It is your responsibility to watch out for other distracted drivers. Anticipate erratic behavior and give distracted drivers extra space.</p>

<h3>6. Stopping Distance Components</h3>

<p>Understanding stopping distance is critical for maintaining safe following distances and avoiding collisions. Total stopping distance consists of three components:</p>

<p><strong>Perception Distance:</strong> The distance your vehicle travels from the time your eyes see a hazard until your brain recognizes it. For an alert driver, perception time is about 3/4 second. At 55 mph, you travel 60 feet during perception time.</p>

<p><strong>Reaction Distance:</strong> The distance traveled from the time your brain recognizes the hazard until your foot physically moves to the brake pedal. Average human reaction time to a hazard is about 0.75-1 second. At 55 mph, this adds another 60 feet.</p>

<p><strong>Braking Distance:</strong> The distance it takes to stop once the brakes are applied. This varies based on speed, weight, road conditions, and brake condition.</p>

<div class="highlight-box">
  <strong>Total Stopping Distance at 55 MPH:</strong> At 55 mph in ideal conditions, total stopping distance is closest to 419 feet. This is longer than a football field! Remember: Perception (60 ft) + Reaction (60 ft) + Braking (approximately 300 ft) = Total Stopping Distance (419 ft)
</div>

<p><strong>Speed and Stopping Distance:</strong> By slowing down, you can significantly reduce braking distance. When you double your speed, stopping distance increases by approximately four times.</p>

<h3>7. Empty vs. Loaded Vehicle Stopping</h3>

<p>This is counterintuitive but critical to understand: Empty vehicles require greater stopping distance than loaded vehicles. While heavier vehicles have more momentum, empty trucks have less traction between the tires and road, which means they can lock up and skid more easily, especially on wet or slippery surfaces.</p>

<h3>8. Following Distance</h3>

<p>Proper following distance is your best defense against rear-end collisions. The FMCSA recommends that commercial drivers maintain at least one second for every 10 feet of vehicle length, plus an additional second for speeds over 40 mph.</p>

<p><strong>Example Calculation:</strong> For a 40-foot vehicle at 50 mph in ideal conditions, the recommended following distance is 5 seconds (4 seconds for vehicle length + 1 additional second for speed over 40 mph).</p>

<div class="success-box">
  <strong>How to Measure Following Distance:</strong>
  <ol style="margin: 10px 0 0 20px;">
    <li>Pick a fixed object ahead (sign, bridge, tree)</li>
    <li>When the vehicle ahead passes it, start counting seconds</li>
    <li>Stop counting when your vehicle reaches that object</li>
    <li>Adjust your speed to maintain proper following distance</li>
  </ol>
</div>

<h3>9. Dealing with Tailgaters</h3>

<p>If a vehicle is tailgating you in bad weather, find a safe place to pull over and let them pass. Never "brake check" a tailgater—this dangerous practice can cause serious accidents. You cannot control others who follow too closely, but you can manage the situation safely by allowing them to pass.</p>

<h3>10. Speed Management</h3>

<p>Professional speed management goes beyond following posted limits—it means adjusting speed for conditions:</p>

<ul>
  <li><strong>Uncertain Conditions:</strong> If you're not sure of road conditions, slow down</li>
  <li><strong>Curves:</strong> Never exceed the posted speed limit for a curve, even if you feel confident</li>
  <li><strong>Night Driving:</strong> If you must use low beams at night, reduce speed to allow more reaction time</li>
  <li><strong>Split Speed Limits:</strong> Where trucks are required to go slower than cars, be extra careful when changing lanes</li>
  <li><strong>Grades:</strong> On steep grades, be in a lower gear before starting the grade</li>
  <li><strong>Work Zones:</strong> Never speed in work zones—penalties are severe and workers' lives depend on your compliance</li>
</ul>

<h3>11. Space Management</h3>

<p>Maintain space ahead—always watch the space in front of your vehicle. If you see brake lights ahead, apply brakes early and smoothly to avoid sudden stops. Staying centered in your lane helps avoid other traffic, and checking mirrors to see your trailer helps you stay centered.</p>

<p><strong>Vehicle Positioning Awareness:</strong></p>
<ul>
  <li>It is not safe to have smaller vehicles traveling next to you—they may be in your blind spots</li>
  <li>High winds can push you out of your lane regardless of vehicle size</li>
  <li>Never assume posted overhead clearance heights are always correct—know your vehicle height</li>
  <li>The clearance under your vehicle is important to monitor for railroad crossings and uneven terrain</li>
</ul>

<h3>12. Turning Procedures</h3>

<p>When making turns, watch your trailer in the mirrors through the whole turn to ensure it's tracking properly and not hitting obstacles. Before pulling into traffic, make sure traffic is clear and you have enough room for your vehicle's length and acceleration capabilities.</p>

<h3>13. Fatigue Management</h3>

<p>If you feel sleepy while driving, the best and only acceptable cure is to stop driving and sleep. Rolling windows down or turning music up are temporary measures that don't address the underlying problem. Drowsy driving is as dangerous as impaired driving.</p>

<h3>14. Pre-Trip Checks for Operating Conditions</h3>

<p>Before starting a trip, check coolant level, heating and defrost systems, wipers, and washer fluid. These systems are critical for maintaining visibility and preventing overheating, especially in adverse weather.</p>

<h3>15. Winter Weather Preparation and Operations</h3>

<p>You should learn how to put chains on before you need them. Practicing in good conditions prevents dangerous delays in bad weather. In bad weather, lack of spray from other vehicles may indicate ice on the road—this is a critical warning sign.</p>

<p><strong>Winter Driving Rules:</strong></p>
<ul>
  <li>Never brake in corners during inclement weather—brake before the turn</li>
  <li>Water in the brakes can cause them to become weak—test brakes after driving through deep water</li>
  <li>In very hot weather, inspect tires every 2 hours or 100 miles to check for heat damage and proper inflation</li>
</ul>

<div class="success-box">
  <strong>Key Takeaways for Section 2:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Look 12-15 seconds ahead and check mirrors constantly</li>
    <li>Objects in convex mirrors appear further than they actually are</li>
    <li>Total stopping distance at 55 mph is approximately 419 feet</li>
    <li>Empty trucks require more stopping distance than loaded trucks</li>
    <li>Maintain 5 seconds following distance for a 40-foot vehicle at 50 mph</li>
    <li>Distracted driving can result in injury or death</li>
    <li>Adjust speed for all conditions, not just posted limits</li>
    <li>Sleep is the only cure for drowsiness while driving</li>
  </ul>
</div>`
      }
    ];
    
    // Continue with sections 3, 4, and 5 in the next part...
    for (const content of sectionContents) {
      await db.query(`
        INSERT INTO section_content (section_id, content_html, modified_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (section_id) DO UPDATE SET
          content_html = EXCLUDED.content_html,
          modified_date = CURRENT_TIMESTAMP,
          modified_by = EXCLUDED.modified_by
      `, [content.section_id, content.content_html, 'system']);
    }
    
    // Add sections 3, 4, and 5 content
    const additionalSections = [
      {
        section_id: 3,
        content_html: `<h2>Advanced Operating Practices</h2>

<p>This section covers the advanced skills and knowledge required to handle emergencies and challenging driving situations. Professional drivers must be prepared to respond effectively to hazards, avoid collisions through defensive driving, and safely navigate emergency scenarios including skids, jackknifing, and railroad crossings.</p>

<div class="highlight-box">
  <strong>Core Principle:</strong> The difference between a professional driver and an average driver is the ability to anticipate emergencies before they happen and respond effectively when they do occur. Advanced operating practices transform hazards into manageable situations.
</div>

<h3>1. Hazard Perception and Recognition</h3>

<p>A hazard is any road condition or other road user that presents potential danger to safe operation. The key distinction is that a hazard is a <em>potential</em> problem, while an emergency is an <em>actual</em> danger. Recognition of hazards before they become emergencies gives you time to respond early and avoid collisions.</p>

<p><strong>What is the best early action when you spot a potential hazard ahead?</strong> Slow down and plan an escape route. This gives you time to think and multiple options for avoiding the hazard if it develops into an emergency.</p>

<div class="success-box">
  <strong>Common Hazard Categories:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li><strong>Drivers with Blocked Vision:</strong> Delivery trucks, vehicles with covered windows, drivers looking at phones</li>
    <li><strong>Pedestrians and Bicyclists:</strong> Especially at intersections, crosswalks, and in urban areas</li>
    <li><strong>Drunk or Distracted Drivers:</strong> Erratic speed, weaving, delayed reactions to signals</li>
    <li><strong>Delivery Trucks:</strong> Frequent stops, backing maneuvers, drivers focused on deliveries</li>
    <li><strong>Stopped Emergency Vehicles:</strong> When you see a stopped emergency vehicle on the roadside, you should move over if safe or slow down significantly</li>
  </ul>
</div>

<h3>2. Defensive Driving and Emergency Preparedness</h3>

<p>To be a prepared defensive driver, you should anticipate emergencies and make a plan. This means constantly asking yourself "what if?" questions as you drive. What if that car suddenly changes lanes? What if the vehicle ahead brakes hard? What if that pedestrian steps into the road?</p>

<p>If you see hazards early and plan a response, you will have more time to act. This extra time can mean the difference between a close call and a collision.</p>

<h3>3. Jackknifing: Prevention and Response</h3>

<p>Jackknifing occurs when the trailer brakes lock and the tractor keeps moving, causing the trailer to swing out and form a 90-degree angle with the tractor. This puts you at severe risk of rollover and loss of control.</p>

<p><strong>When Jackknifing is Most Likely:</strong> Jackknifing is most likely to occur when trailer brakes lock and the tractor keeps moving. This typically happens during hard braking on slippery surfaces or when braking while turning.</p>

<div class="warning-box">
  <strong>Immediate Response to Jackknifing:</strong> If your trailer begins to jackknife, the correct immediate response is to remain calm and avoid overcorrection. Release the brakes to allow the wheels to roll again, which helps restore traction. Avoid the panic response of stomping harder on the brakes—this only makes the situation worse.
</div>

<p><strong>If Your Trailer Begins to Swing Out:</strong> Slow gradually and avoid abrupt steering. Sudden movements will make the jackknife worse. Let the vehicle slow naturally while maintaining as straight a path as possible.</p>

<h3>4. Skid Control and Recovery</h3>

<p>Skids occur when your tires lose traction with the road surface. Understanding how to prevent and recover from skids is essential for safe operation.</p>

<p><strong>When a Trailer Starts to Skid:</strong> Steer into the skid and ease off the brakes. This helps the wheels regain traction and allows you to restore control. Turning away from the skid or braking harder will only make things worse.</p>

<p><strong>Signs of Brake Fade:</strong> Watch for these warning signs that your brakes are fading:</p>
<ul>
  <li>A strong burning smell from the brakes</li>
  <li>A spongy brake pedal with reduced braking power</li>
  <li>Increased pedal travel required to achieve braking</li>
  <li>The need to press harder to get the same braking effect</li>
</ul>

<div class="highlight-box">
  <strong>Pumping Brakes and ABS:</strong> When a skid begins, pumping the brakes is recommended only if you do not have ABS. If your vehicle has ABS, apply steady, firm pressure—the system will automatically pulse the brakes for maximum control. Never pump ABS brakes.
</div>

<h3>5. Emergency Braking Techniques</h3>

<p>When you must stop quickly in an emergency, proper braking technique can prevent loss of control while achieving the shortest possible stopping distance.</p>

<p><strong>The Stab Braking Method:</strong> Apply brakes firmly without locking. If wheels begin to lock, release the brake pedal slightly until wheels start rolling again, then reapply. This method provides maximum braking power while avoiding skids. The key is to release as soon as you feel the wheels lock, allow them to roll briefly, then reapply firmly.</p>

<p><strong>Controlled Braking:</strong> Apply steady pressure just short of wheel lockup and maintain control throughout the stop. This requires practice and feel for your specific vehicle.</p>

<h3>6. Evasive Steering Maneuvers</h3>

<p>When you don't have time to stop, evasive steering is often faster than braking. However, it must be done correctly to avoid loss of control.</p>

<p><strong>Proper Evasive Steering Technique:</strong></p>
<ul>
  <li><strong>Steer Smoothly:</strong> Avoid sudden overcorrections. If you must use evasive steering to avoid a crash, steer smoothly and avoid sudden overcorrections that can cause rollovers or jackknifing</li>
  <li><strong>Minimal Steering Input:</strong> Turn only as much as necessary to clear the obstacle. The more sharply you turn, the greater the risk of rollover</li>
  <li><strong>Don't Brake While Turning:</strong> Braking during a turn can lock wheels and cause complete loss of control</li>
  <li><strong>Be Prepared to Countersteer:</strong> Once you clear the obstacle, turn back in the opposite direction to straighten the vehicle</li>
</ul>

<h3>7. Leaving the Roadway in Emergencies</h3>

<p>Sometimes the safest option is to leave the paved surface. If you must leave the roadway to avoid a crash, you should slow as much as possible and steer smoothly off the road. Avoid sudden movements that could cause rollover.</p>

<p><strong>Off-Road Recovery Procedure:</strong></p>
<ol>
  <li>Slow down as much as possible before leaving pavement</li>
  <li>Keep one set of wheels on pavement if possible for better control</li>
  <li>Steer as straight as possible—avoid sharp turns</li>
  <li>If shoulder is clear, stay on it until completely stopped</li>
  <li>Only use brakes gently once speed has dropped significantly</li>
  <li>Signal and check mirrors before returning to road</li>
</ol>

<h3>8. Preventing Emergencies on Slippery Roads</h3>

<p>Prevention is always better than reaction. Several practices help prevent emergencies on slippery roads:</p>

<div class="success-box">
  <strong>Slippery Road Prevention Strategies:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li><strong>Increase Following Distance:</strong> Double or triple your normal following distance</li>
    <li><strong>Reduce Speed:</strong> Slow down well before conditions require it</li>
    <li><strong>Avoid Sudden Actions:</strong> No sudden steering, braking, or acceleration</li>
    <li><strong>All of the Above:</strong> Use all these strategies together for maximum safety</li>
  </ul>
</div>

<h3>9. Work Zone Safety</h3>

<p>Work zones present unique hazards with workers, equipment, reduced space, and changing traffic patterns. When approaching a work zone, the safest approach is to slow down, watch for workers, and follow all signs and flaggers' directions.</p>

<h3>10. Railroad-Highway Grade Crossings</h3>

<p>Railroad crossings are among the most dangerous locations for commercial vehicles due to the severe consequences of train-vehicle collisions. Professional drivers must treat every crossing with extreme caution.</p>

<div class="warning-box">
  <strong>Critical Railroad Crossing Rule:</strong> Approach every railroad crossing expecting a train. Never assume the crossing is safe just because you don't see or hear a train. Some trains can approach at speeds exceeding 100 mph and may not be visible until it's too late to stop.
</div>

<p><strong>Crossing Approach Procedure:</strong> Slow down, look both ways, and listen for trains. This should be done at every crossing, regardless of whether there are active warning devices.</p>

<p><strong>Vehicles Required to Stop:</strong> Which vehicles are required to stop at public railroad crossings? Vehicles carrying hazardous materials AND passenger buses (both b and c). These vehicles must stop between 15 and 50 feet from the nearest rail, even if no train is visible.</p>

<p><strong>Stopping Distance from Rails:</strong> If required to stop at a railroad crossing, how far from the nearest rail should you stop? Between 15 and 50 feet. This distance allows you to see approaching trains while giving you enough space to clear the crossing if a train approaches.</p>

<div class="danger-box" style="background: rgba(239, 68, 68, 0.15); border-left: 4px solid var(--danger); padding: 18px; margin: 20px 0; border-radius: 8px;">
  <strong>If Your Vehicle Stalls on Tracks:</strong> Get out immediately and move away from the tracks at a 45-degree angle in the direction the train is coming from. This protects you from debris. Then call for help. Never stay in the vehicle or attempt to push it off the tracks.
</div>

<div class="success-box">
  <strong>Key Takeaways for Section 3:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Slow down and plan an escape route when you spot potential hazards</li>
    <li>Anticipate emergencies and make plans before they happen</li>
    <li>If trailer jackknifes, remain calm and release brakes to restore traction</li>
    <li>Steer into skids and ease off brakes to regain control</li>
    <li>When evasive steering is necessary, steer smoothly without overcorrecting</li>
    <li>Increase following distance, reduce speed, and avoid sudden actions on slippery roads</li>
    <li>Approach every railroad crossing expecting a train</li>
    <li>Hazmat and passenger vehicles must stop 15-50 feet from railroad tracks</li>
    <li>If stalled on tracks, get out immediately and move away at an angle</li>
    <li>Early hazard recognition gives you time to prevent emergencies</li>
  </ul>
</div>`
      },
      {
        section_id: 4, 
        content_html: `<h2>Vehicle Systems & Malfunctions</h2>

<p>This section covers how to identify vehicle system problems early, understand common malfunctions, and take appropriate action. Professional drivers must be able to detect issues before they become dangerous failures, understand inspection procedures, and maintain proper documentation for compliance.</p>

<div class="highlight-box">
  <strong>Core Principle:</strong> Early detection of vehicle system problems can prevent accidents, reduce downtime, and save lives. Understanding how systems fail and recognizing warning signs are critical skills for professional drivers.
</div>

<h3>1. Detecting System Malfunctions Using Your Senses</h3>

<p>Your senses are powerful diagnostic tools that can detect problems before they appear on gauges or warning lights. Learning to interpret what you see, hear, smell, and feel can prevent catastrophic failures.</p>

<p><strong>Detecting Oil Leaks:</strong> Which senses help you detect an oil leak early? Sight (visible pools under the vehicle) and smell (burning oil odor). Fresh oil appears amber or dark brown under the vehicle, while burning oil produces a distinct acrid smell when it contacts hot engine components.</p>

<div class="warning-box">
  <strong>Oil System Warnings:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li><strong>Visual Signs:</strong> Puddles or spots under the engine, oil on the ground after parking, low oil level on dipstick, oil coating on engine components</li>
    <li><strong>Smell:</strong> Burning oil smell from exhaust or engine compartment indicates oil is leaking onto hot surfaces</li>
    <li><strong>Action Required:</strong> Stop immediately if you suspect a major oil leak. Operating with low oil pressure can destroy an engine in minutes</li>
  </ul>
</div>

<h3>2. Auxiliary System Malfunctions</h3>

<p>Auxiliary systems like the alternator, water pump, power steering pump, and cooling fan are critical for safe operation. Which signs indicate an auxiliary system malfunction? Both unusual noises and vibration, as well as warning lights and loss of power.</p>

<p><strong>Common Auxiliary System Warning Signs:</strong></p>
<ul>
  <li><strong>Alternator Failure:</strong> Dimming lights, battery warning light, electrical accessories losing power, voltmeter showing low voltage</li>
  <li><strong>Water Pump Failure:</strong> Overheating, coolant leaks, squealing or grinding noises, steam from under hood</li>
  <li><strong>Power Steering Pump:</strong> Whining noise when turning, difficulty steering, power steering fluid leaks</li>
  <li><strong>Cooling Fan Issues:</strong> Engine overheating, unusual noises from fan clutch or motor, fan not engaging</li>
</ul>

<h3>3. Brake System Problems</h3>

<p>Brake fade is one of the most dangerous conditions you can encounter. Which two senses help identify brake fade? Smell (burning brakes) and feeling (spongy pedal with reduced effectiveness).</p>

<p><strong>Brake Fade Warning Signs:</strong></p>
<ul>
  <li><strong>Smell:</strong> Strong burning odor from wheels or brakes, often smells like burning rubber or hot metal</li>
  <li><strong>Feel:</strong> Spongy or soft brake pedal, increased pedal travel needed, reduced braking response, pedal sinking to floor</li>
  <li><strong>Performance:</strong> Vehicle takes longer to stop, brakes feel weak or ineffective, need to press harder for same result</li>
</ul>

<div class="danger-box" style="background: rgba(239, 68, 68, 0.15); border-left: 4px solid var(--danger); padding: 18px; margin: 20px 0; border-radius: 8px;">
  <strong>Brake Fade Emergency Response:</strong> If you experience brake fade, downshift immediately to use engine braking, find a safe escape route, and prepare to use escape ramps if available. Never continue driving with faded brakes—they can fail completely without warning.
</div>

<h3>4. Drive Shaft and Driveline Problems</h3>

<p>What are common signs of a failing drive shaft? Clunking sounds and vibration. The drive shaft transmits power from the transmission to the rear axle, and when it fails, the symptoms are usually obvious.</p>

<h3>5. Suspension System Issues</h3>

<p>If the tractor leans to one side, which system is likely at fault? The leaf spring suspension. Suspension problems affect vehicle stability and can make the vehicle dangerous to operate.</p>

<h3>6. Coupling System Problems</h3>

<p>If you do not hear a click when coupling, what might be wrong? The locking jaws did not close properly. This is a critical safety issue that could result in the trailer separating from the tractor while driving.</p>

<div class="warning-box">
  <strong>Proper Coupling Verification:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Listen for audible click or clunk when fifth wheel locks</li>
    <li>Visually inspect that jaws are closed around kingpin</li>
    <li>Perform tug test by gently pulling forward against locked fifth wheel</li>
    <li>Check that safety latch is engaged and lock handle is secure</li>
    <li>Never assume coupling is secure without verification—improper coupling causes fatal accidents</li>
  </ul>
</div>

<h3>7. Roadside Inspection Levels</h3>

<p>What level of inspection is a walk-around driver/vehicle inspection? Level 2. Understanding inspection levels helps you know what to expect during roadside inspections and what standards your vehicle must meet.</p>

<h3>8. Pre-Trip Inspections and Compliance</h3>

<p>Does a standard Pre-Trip Inspection help you pass a roadside inspection? Yes, it finds items inspectors would catch. Thorough pre-trip inspections are your first line of defense against violations and out-of-service orders.</p>

<h3>9. Out-of-Service Orders</h3>

<p>If placed out-of-service, can you legally move the vehicle? No. An out-of-service order is a legal directive that prohibits operation until the violation is corrected. Violating an out-of-service order carries severe penalties.</p>

<h3>10. Preventive Maintenance Importance</h3>

<p>Why perform preventive maintenance on equipment? To extend service life and prevent breakdowns. Preventive maintenance is not just about compliance—it's about keeping you safe and preventing expensive failures.</p>

<div class="success-box">
  <strong>Key Takeaways for Section 4:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Use sight and smell to detect oil leaks early</li>
    <li>Auxiliary system failures show through unusual noises, vibration, and warning lights</li>
    <li>Brake fade is detected by smell and spongy pedal feel</li>
    <li>Drive shaft problems cause clunking and vibration</li>
    <li>Suspension issues cause vehicle to lean and handle poorly</li>
    <li>Always verify proper coupling with multiple methods</li>
    <li>Level 2 inspections are walk-around driver/vehicle checks</li>
    <li>Pre-trip inspections help you pass roadside inspections</li>
    <li>Out-of-service orders must be obeyed—no exceptions</li>
    <li>Preventive maintenance extends service life and prevents breakdowns</li>
  </ul>
</div>`
      },
      {
        section_id: 5,
        content_html: `<h2>Non-Driving Activities</h2>

<p>This section covers the essential administrative, regulatory, and health-related responsibilities that professional drivers must manage beyond actual driving. Success as a commercial driver requires understanding medical requirements, cargo securement, hours of service regulations, trip planning, incident response, and professional conduct standards.</p>

<div class="highlight-box">
  <strong>Core Principle:</strong> Professional driving is about more than operating a vehicle. It requires managing compliance with complex regulations, maintaining your health and qualifications, planning trips effectively, and conducting yourself professionally in all situations.
</div>

<h3>1. Medical Certification Requirements</h3>

<p>If you fail to keep your medical certificate current, what can happen to your CDL? It may be suspended. Your medical certificate is not optional—it's a legal requirement that directly affects your ability to work.</p>

<p><strong>Medical Certificate Compliance:</strong></p>
<ul>
  <li><strong>Standard Validity:</strong> Most medical certificates are valid for 24 months (2 years)</li>
  <li><strong>Shorter Periods:</strong> Some conditions require annual or more frequent recertification</li>
  <li><strong>Grace Periods:</strong> No grace period exists—driving with expired certificate is illegal</li>
  <li><strong>Self-Certification:</strong> You must self-certify the type of driving you perform (interstate vs. intrastate)</li>
  <li><strong>State Notification:</strong> Medical certificate information must be on file with your state DMV</li>
</ul>

<div class="warning-box">
  <strong>Medical Examiner Honesty:</strong> Should you hide prescription medications from a DOT examiner? No. You must disclose all prescriptions and over-the-counter drugs. If a DOT medical examiner asks about medications, you should disclose all prescriptions and over-the-counter drugs. Hiding medications can result in medical certificate fraud, CDL revocation, and criminal charges.
</div>

<h3>2. Cargo Securement Responsibilities</h3>

<p>As a professional driver, who is responsible for cargo safety? The driver. Even if someone else loaded your trailer, you are ultimately responsible for ensuring the cargo is properly secured and safe to transport.</p>

<p><strong>Why is it important to keep cargo low and centered?</strong> To lower the center of gravity and improve stability. High or off-center loads increase rollover risk and make the vehicle harder to control.</p>

<h3>3. Loading Dock Safety</h3>

<p>Before pulling out of a dock, you should visually check the dock area for people and obstructions. Never rely solely on dock workers—you are responsible for ensuring the area is clear before moving.</p>

<h3>4. Maintenance Issues During Travel</h3>

<p>If you have a major engine oil leak, the correct action is to stop and repair or report before continuing. Never attempt to continue driving with a major mechanical issue by just adding fluid—this can cause catastrophic failure.</p>

<h3>5. Hazardous Materials Emergency Response</h3>

<p>Where should you look for emergency response information for hazardous materials? The Emergency Response Guidebook (ERG). This standardized reference provides critical information for emergency responders and drivers.</p>

<h3>6. Interstate vs. Intrastate Commerce</h3>

<p>Understanding the distinction between interstate and intrastate commerce is important for determining which regulations apply to your operations.</p>

<p><strong>Interstate commerce means:</strong> Traveling between states, or transporting goods that originated in one state and will be delivered to another state, even if you never cross state lines yourself.</p>

<h3>7. Hours of Service (HOS) Regulations</h3>

<p>Can you use a commercial vehicle for personal use and ignore federal HOS rules? No. HOS rules apply whenever you are operating a commercial motor vehicle, with very limited exceptions for personal conveyance.</p>

<h3>8. Fatigue Management</h3>

<p>If you are fatigued, the best action is to take a break or sleep before continuing. No amount of caffeine, fresh air, or willpower can substitute for adequate rest.</p>

<h3>9. Driver Wellness and Health</h3>

<p><strong>Which of the following supports driver wellness?</strong> Regular sleep, healthy meals, and exercise. Professional drivers face unique health challenges, and maintaining wellness requires deliberate effort.</p>

<h3>10. Incident Response and Crash Procedures</h3>

<p>After a crash with injuries, you should first ensure safety and call emergency services. This includes checking for injuries, moving to safety if possible, and getting help for injured parties.</p>

<div class="success-box">
  <strong>Key Takeaways for Section 5:</strong>
  <ul style="margin: 10px 0 0 0;">
    <li>Medical certificates are mandatory—keep them current to avoid CDL suspension</li>
    <li>Always disclose all medications to DOT medical examiners</li>
    <li>Drivers are responsible for cargo safety regardless of who loaded it</li>
    <li>Keep cargo low and centered to improve vehicle stability</li>
    <li>Stop and repair major mechanical issues before continuing</li>
    <li>Use Emergency Response Guidebook for hazmat incidents</li>
    <li>HOS rules apply to all CMV operation with limited exceptions</li>
    <li>Sleep is the only cure for fatigue while driving</li>
    <li>Wellness requires regular sleep, healthy meals, and exercise</li>
    <li>Prioritize safety and emergency services after crashes with injuries</li>
  </ul>
</div>`
      }
    ];
    
    for (const content of additionalSections) {
      await db.query(`
        INSERT INTO section_content (section_id, content_html, modified_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (section_id) DO UPDATE SET
          content_html = EXCLUDED.content_html,
          modified_date = CURRENT_TIMESTAMP,
          modified_by = EXCLUDED.modified_by
      `, [content.section_id, content.content_html, 'system']);
    }
    
    console.log('✅ Section content initialized successfully');
    
  } catch (error) {
    console.error('💥 Error initializing section content:', error);
    throw error;
  }
}

// Initialize section content on startup
initializeSectionContent().catch(console.error);

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
    
    await ensureProgressTrackerTable();
    
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

// Legacy quiz reset endpoint  
app.post('/api/quiz-legacy/reset', authenticateToken, async (req, res) => {
  try {
    console.log(`🔄 [RETAKE-LEGACY] Legacy quiz reset requested`);
    // For legacy quizzes, we just redirect back as they don't use database
    res.redirect('/?message=Legacy quiz reset - please start the quiz again');
  } catch (error) {
    console.error('❌ [RETAKE-LEGACY] Error:', error);
    res.redirect('/?error=Failed to reset legacy quiz');
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

// Quiz questions repopulation endpoint
app.post('/api/admin/repopulate-questions', authenticateToken, async (req, res) => {
  try {
    console.log(`🔧 [ADMIN] REPOPULATING ALL QUIZ QUESTIONS`);
    
    // Define the complete quizRegistry from the frontend
    const quizRegistry = {
      1: { title: "Basic Operation", questions: [
        { q: "What must you do to successfully complete this course?", options: { a: "Finish all lessons with at least 80%", b: "Finish all lessons with at least 70%", c: "Finish all lessons with at least 85%" }, correct: "a" },
        { q: "Who is responsible for the safety of the load and vehicle?", options: { a: "The driver", b: "The loader", c: "The company" }, correct: "a" },
        { q: "Driving a commercial vehicle is a serious responsibility.", options: { a: "Because it involves safety of lives and cargo", b: "Because it requires following strict regulations", c: "Because it is just like driving a car", d: "Because it is optional" }, correct: "a" },
        { q: "FMCSRs and HMRs are…", options: { a: "Minimum safety standards for trucking", b: "Guidelines only for passenger cars", c: "Optional recommendations", d: "Rules only for state police" }, correct: "a" },
        { q: "Vehicle size and weight limits…", options: { a: "Are the same in every state", b: "Differ depending on the state", c: "Are set only by federal law", d: "Don't apply to commercial vehicles" }, correct: "b" },
        { q: "Why is a Pre-Trip inspection important?", options: { a: "To find defects that could cause accidents", b: "To make your boss happy", c: "It isn't important" }, correct: "a" },
        { q: "Checking oil level during Pre-Trip is important because…", options: { a: "It prevents engine damage", b: "It's required by law", c: "It saves fuel", d: "It's optional" }, correct: "a" },
        { q: "What is the minimum steer tire tread depth?", options: { a: "3/32\"", b: "2/32\"", c: "4/32\"" }, correct: "c" },
        { q: "If you notice unusual sounds, smells, or vibrations while driving, you should…", options: { a: "Continue driving normally", b: "Stop and check immediately", c: "Ignore them if minor", d: "Report only at the end of the trip" }, correct: "b" },
        { q: "Is the service brake a primary or secondary component?", options: { a: "Primary", b: "Secondary" }, correct: "a" },
        { q: "What does the voltage gauge show?", options: { a: "Operating voltage", b: "Fuel level", c: "Oil pressure" }, correct: "a" },
        { q: "If the ABS light stays on…", options: { a: "ABS is working properly", b: "ABS is not working properly", c: "ABS is optional equipment", d: "ABS only matters in rain" }, correct: "b" },
        { q: "How long should it take to build air pressure from 50–90 PSI?", options: { a: "1 minute", b: "3 minutes", c: "5 minutes" }, correct: "b" },
        { q: "How long should you hold the brake pedal when testing hydraulic brakes?", options: { a: "3 seconds", b: "5 seconds", c: "10 seconds" }, correct: "b" },
        { q: "Does pulling the trailer brake lever harder increase trailer braking force?", options: { a: "Yes", b: "No" }, correct: "b" },
        { q: "Adjusting seat and mirrors before driving ensures…", options: { a: "Maximum visibility", b: "Comfort only", c: "Faster driving", d: "Nothing important" }, correct: "a" },
        { q: "Keeping mirrors and the windshield clean helps prevent accidents.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "What is the most important thing to watch during turns?", options: { a: "Your phone", b: "The rear of your trailer", c: "Your shift pattern" }, correct: "b" },
        { q: "Low bridge signs…", options: { a: "Are always accurate", b: "May be inaccurate", c: "Apply only to cars", d: "Are optional to follow" }, correct: "b" },
        { q: "Was the bridge weight formula created to protect older bridges?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Backing should be avoided because…", options: { a: "It increases accident risk", b: "It wastes fuel", c: "It is illegal", d: "It is slower" }, correct: "a" },
        { q: "Does your starting position matter when backing?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Should you get out and look (G.O.A.L.) before backing?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Blind side backing is more dangerous because…", options: { a: "Visibility is reduced", b: "It takes longer", c: "It damages tires", d: "It is illegal" }, correct: "a" },
        { q: "Is using a spotter helpful, even though you are still responsible?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "How far should you press the clutch when shifting a non-synced transmission?", options: { a: "To the floor", b: "2–3 inches", c: "Neither" }, correct: "b" },
        { q: "If you miss a gear, should you keep the clutch pressed down?", options: { a: "Yes, until you stop", b: "No, release and try again", c: "Only if downhill", d: "Only if uphill" }, correct: "b" },
        { q: "When downshifting a non-synced transmission, what RPM should you drop to before shifting to neutral?", options: { a: "1100", b: "900", c: "700" }, correct: "c" },
        { q: "Is proper shifting technique important to prevent equipment damage?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "On the interstate, you should…", options: { a: "Relax and stop paying attention", b: "Stay alert and scan ahead", c: "Drive faster than normal", d: "Ignore mirrors" }, correct: "b" },
        { q: "In tight areas, you should…", options: { a: "Always have an exit strategy", b: "Rely on luck", c: "Stop and wait", d: "Ignore surroundings" }, correct: "a" },
        { q: "When should you first inspect your cargo after starting your trip?", options: { a: "25 miles", b: "50 miles", c: "75 miles" }, correct: "b" },
        { q: "Do different rigs have different coupling/uncoupling procedures?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "What should you do before coupling?", options: { a: "Inspect the area and chock wheels", b: "Immediately back under the trailer", c: "Skip inspection" }, correct: "a" },
        { q: "When backing under a trailer, what should you do?", options: { a: "Use lowest reverse gear", b: "Back slowly", c: "Stop when kingpin locks", d: "All of the above" }, correct: "d" },
        { q: "Should you visually inspect the coupling to ensure it is secure?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Which lines must be checked for proper connection?", options: { a: "Electrical cord", b: "Air lines", c: "Both" }, correct: "c" },
        { q: "Why must you check trailer clearance after raising landing gear?", options: { a: "To avoid tractor–trailer damage", b: "To avoid landing gear catching during turns", c: "Both" }, correct: "c" },
        { q: "What is the final step after raising landing gear and checking clearance?", options: { a: "Remove wheel chocks", b: "Drive away immediately" }, correct: "a" },
        { q: "When uncoupling, what must you do before unlocking the fifth wheel?", options: { a: "Position the rig correctly", b: "Ease pressure on locking jaws", c: "Both" }, correct: "c" },
        { q: "Should you chock trailer wheels if it has no spring brakes?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Should you keep your feet clear of tractor wheels when unlocking the fifth wheel?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Should the tractor remain under the trailer until you confirm landing gear is stable?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Should you secure the tractor before inspecting trailer supports?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "When inspecting trailer supports, what should you check?", options: { a: "Ground support", b: "Landing gear condition", c: "Both" }, correct: "c" },
        { q: "After confirming landing gear is stable, is it safe to pull the tractor away?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Wider vehicles…", options: { a: "Have less room for error", b: "Are easier to maneuver", c: "Require no special care", d: "Are exempt from rules" }, correct: "a" },
        { q: "Should you be 100% sure nothing is behind you before backing?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Should you always use the lowest gear when backing?", options: { a: "Yes", b: "No" }, correct: "a" },
      ]},
      2: { title: "Safe Operating Procedures", questions: [
        { q: "You should always be aware of your surroundings when driving a CMV.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "How far ahead should you look when driving a CMV?", options: { a: "3–6 seconds", b: "7–10 seconds", c: "12–15 seconds" }, correct: "c" },
        { q: "Is it acceptable to drive without checking your mirrors regularly?", options: { a: "Yes", b: "No", c: "Only on straight, empty roads" }, correct: "b" },
        { q: "Objects in convex mirrors appear:", options: { a: "Closer than they are", b: "Further than they are", c: "The same as in flat mirrors" }, correct: "b" },
        { q: "When signaling a lane change, you should:", options: { a: "Signal and wait for traffic to clear before moving", b: "Signal and immediately move", c: "Not signal" }, correct: "a" },
        { q: "Is it acceptable to wave your hands out the window to direct traffic?", options: { a: "Yes", b: "No", c: "Only in emergencies" }, correct: "b" },
        { q: "Use headlights during the day when visibility is low.", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "How long do you have to place emergency warning devices after stopping?", options: { a: "5 minutes", b: "10 minutes", c: "As soon as possible" }, correct: "b" },
        { q: "On a two-way highway, the standard placement of warning devices is:", options: { a: "20 ft from vehicle and 200 ft ahead/behind", b: "10 ft from vehicle and 100 ft ahead/behind", c: "20 ft from vehicle and 100 ft ahead/behind" }, correct: "b" },
        { q: "If the view is obstructed, how far back should the last device be placed?", options: { a: "150 ft", b: "250 ft", c: "100–500 ft depending on obstruction" }, correct: "c" },
        { q: "Distracted driving is anything that takes your attention away from driving.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "If you are not focused while operating a CMV, the likely outcome is:", options: { a: "Minor inconvenience", b: "Injury or death to you or others", c: "No consequence" }, correct: "b" },
        { q: "Should you pull over before checking a mobile device?", options: { a: "Yes", b: "No", c: "Only if traffic is heavy" }, correct: "a" },
        { q: "To be a professional driver you must stay focused and avoid distractions.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Is it your responsibility to watch out for other distracted drivers?", options: { a: "Yes", b: "No", c: "Only in urban areas" }, correct: "a" },
        { q: "Perception distance is the distance your vehicle travels from seeing a hazard until you recognize it.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Average human reaction time to a hazard is about:", options: { a: "2–3 seconds", b: "1–2 seconds", c: "0.75–1 second", d: "Less than 0.5 second" }, correct: "c" },
        { q: "At 55 mph in ideal conditions, stopping distance is closest to:", options: { a: "220 feet", b: "319 feet", c: "419 feet" }, correct: "c" },
        { q: "By slowing down you can reduce braking distance.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Which requires greater stopping distance?", options: { a: "Empty vehicle", b: "Loaded vehicle", c: "Both the same" }, correct: "a" },
        { q: "A vehicle is tailgating you in bad weather. What should you do?", options: { a: "Speed up to keep traffic flowing", b: "Find a safe place to pull over and let them pass", c: "Brake-check them" }, correct: "b" },
        { q: "If you're not sure of road conditions, you should:", options: { a: "Slow down", b: "Maintain speed", c: "Speed up to clear the area" }, correct: "a" },
        { q: "Should you ever exceed the posted speed limit for a curve?", options: { a: "Yes, if you feel confident", b: "No", c: "Only if empty and light load" }, correct: "b" },
        { q: "If you must use low beams at night, should you reduce speed to allow more reaction time?", options: { a: "Yes", b: "No", c: "Only in heavy traffic" }, correct: "a" },
        { q: "Where trucks are required to go slower, be extra careful when changing lanes.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "On steep grades, you should be in a lower gear before starting the grade.", options: { a: "Yes", b: "No", c: "Only if heavy load" }, correct: "a" },
        { q: "Never speed in work zones.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Maintain space ahead – always watch the space in front of your vehicle.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "If you see brake lights ahead, you should:", options: { a: "Apply brakes early and smoothly", b: "Ignore them", c: "Swerve around" }, correct: "a" },
        { q: "For a 40ft vehicle at 50 mph in ideal conditions, recommended following distance is:", options: { a: "4 seconds", b: "5 seconds", c: "7 seconds" }, correct: "b" },
        { q: "Should you ever 'brake check' a tailgater?", options: { a: "No", b: "Yes", c: "Only in emergencies" }, correct: "a" },
        { q: "Staying centered in your lane helps avoid other traffic.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Checking mirrors to see your trailer helps you stay centered.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Is it safe to have smaller vehicles traveling next to you?", options: { a: "Yes", b: "No", c: "Only at low speed" }, correct: "b" },
        { q: "Can high winds push you out of your lane regardless of vehicle size?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "Should you assume posted overhead clearance heights are always correct?", options: { a: "Yes", b: "No", c: "Only on major highways" }, correct: "b" },
        { q: "Is the clearance under your vehicle important to monitor?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "When making turns, watch your trailer in the mirrors through the whole turn.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Before pulling into traffic, make sure traffic is clear and you have enough room.", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "If you feel sleepy while driving, the best cure is:", options: { a: "Roll windows down", b: "Turn music up", c: "Stop driving and sleep" }, correct: "c" },
        { q: "Before starting a trip, check coolant, heating/defrost, wipers and washer fluid.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Should you learn how to put chains on before you need them?", options: { a: "Yes", b: "No", c: "Only if you drive in snow regularly" }, correct: "a" },
        { q: "In bad weather, lack of spray from other vehicles may indicate ice on the road.", options: { a: "True", b: "False" }, correct: "a" },
        { q: "Should you brake in corners during inclement weather?", options: { a: "No", b: "Yes", c: "Only lightly" }, correct: "a" },
        { q: "Can water in the brakes cause them to become weak?", options: { a: "Yes", b: "No" }, correct: "a" },
        { q: "How often should you inspect tires in very hot weather?", options: { a: "Every 4 hours / 200 miles", b: "Every 2 hours / 100 miles", c: "Every 1 hour / 50 miles" }, correct: "b" }
      ]},
      3: { title: "Advanced Operating Practices", questions: [
        { q: "What is the best early action when you spot a potential hazard ahead?", options: { a: "Ignore it until it becomes urgent", b: "Slow down and plan an escape route", c: "Honk and maintain speed", d: "Speed up to pass quickly" }, correct: "b" },
        { q: "If you see a stopped emergency vehicle on the roadside, you should:", options: { a: "Maintain speed and lane", b: "Move over if safe or slow down", c: "Stop in the lane", d: "Flash lights and continue" }, correct: "b" },
        { q: "Which drivers are likely to create hazards you should watch for?", options: { a: "Drivers with blocked vision", b: "Pedestrians and bicyclists", c: "Drunk drivers and delivery trucks", d: "All of the above" }, correct: "d" },
        { q: "To be a prepared defensive driver you should:", options: { a: "Only watch the vehicle ahead", b: "Anticipate emergencies and make a plan", c: "Rely on other drivers to react", d: "Drive faster to avoid hazards" }, correct: "b" },
        { q: "If your trailer begins to jackknife, the correct immediate response is to:", options: { a: "Panic and stomp the brakes", b: "Remain calm and avoid overcorrection", c: "Turn the wheel sharply away from the trailer", d: "Accelerate to straighten out" }, correct: "b" },
        { q: "When you don't have time to stop, evasive steering is often faster than braking.", options: { a: "True", b: "False", c: "Only on dry pavement" }, correct: "a" },
        { q: "Which describes the stab braking method?", options: { a: "Pump the brakes continuously", b: "Apply brakes firmly without locking, then release if needed", c: "Fully apply and hold the brakes", d: "Use engine brake only" }, correct: "b" },
        { q: "Approach every railroad crossing expecting a train. What should you do first?", options: { a: "Speed up to cross quickly", b: "Slow, look, and listen for trains", c: "Shift gears while crossing", d: "Ignore signs if no lights" }, correct: "b" },
        { q: "Which vehicles are required to stop at public railroad crossings?", options: { a: "All commercial motor vehicles", b: "Vehicles carrying hazardous materials", c: "Passenger buses", d: "Both b and c" }, correct: "d" },
        { q: "If required to stop at a railroad crossing, how far from the nearest rail should you stop?", options: { a: "Between 10 and 45 feet", b: "Between 15 and 50 feet", c: "Directly on the rail", d: "More than 100 feet" }, correct: "b" },
        { q: "If your vehicle stalls on the tracks, what is the correct immediate action?", options: { a: "Stay inside and wait", b: "Get out and move away from the tracks, then call for help", c: "Try to push the vehicle off the tracks", d: "Signal other drivers to stop" }, correct: "b" },
        { q: "When a trailer starts to skid, which action helps regain control?", options: { a: "Brake hard and hold", b: "Steer into the skid and ease off the brakes", c: "Turn sharply away from the skid", d: "Shift to neutral and coast" }, correct: "b" },
        { q: "Which of these is a sign your brakes are fading?", options: { a: "A strong burning smell", b: "A spongy pedal and reduced braking power", c: "Brake pedal feels firm and responsive", d: "Both a and b" }, correct: "d" },
        { q: "If you must use evasive steering to avoid a crash, you should:", options: { a: "Oversteer aggressively", b: "Steer smoothly and avoid sudden overcorrections", c: "Let go of the wheel", d: "Brake and steer at the same time hard" }, correct: "b" },
        { q: "Jackknifing is most likely to occur when:", options: { a: "Trailer brakes lock and tractor keeps moving", b: "You accelerate on a straight road", c: "You use cruise control downhill", d: "Trailer is empty" }, correct: "a" },
        { q: "If your trailer begins to swing out, you should:", options: { a: "Speed up to straighten it", b: "Slow gradually and avoid abrupt steering", c: "Brake hard immediately", d: "Shift to neutral and coast" }, correct: "b" },
        { q: "When approaching a work zone, the safest approach is to:", options: { a: "Maintain speed and lane", b: "Slow down, watch for workers, and follow signs", c: "Weave through traffic to pass quickly", d: "Stop in the lane" }, correct: "b" },
        { q: "If you must leave the roadway to avoid a crash, you should:", options: { a: "Swerve sharply at high speed", b: "Slow as much as possible and steer smoothly off the road", c: "Jump the curb", d: "Brake and hold while turning hard" }, correct: "b" },
        { q: "When a skid begins, pumping the brakes is recommended only if you do not have ABS.", options: { a: "True", b: "False", c: "Only on wet roads" }, correct: "a" },
        { q: "Which of the following helps prevent emergencies on slippery roads?", options: { a: "Increase following distance", b: "Reduce speed", c: "Avoid sudden steering or braking", d: "All of the above" }, correct: "d" },
        { q: "If you see hazards early and plan a response, you will have more time to act.", options: { a: "True", b: "False", c: "Only in daylight" }, correct: "a" },
        { q: "At a crossing with gates and flashing lights, you should:", options: { a: "Stop when lights begin to flash", b: "Try to beat the gate if you think you can clear it", c: "Drive around the gate", d: "Honk and proceed" }, correct: "a" },
        { q: "If you must leave the vehicle after an emergency, you should:", options: { a: "Stand close to the vehicle on the roadway", b: "Move to a safe location away from traffic and tracks", c: "Wait between lanes", d: "Stay inside until help arrives" }, correct: "b" }
      ]},
      4: { title: "Vehicle Systems & Malfunctions", questions: [
        { q: "Which senses help you detect an oil leak early?", options: { a: "Sight (pools) and smell (burning oil)", b: "Only hearing", c: "Only touch" }, correct: "a" },
        { q: "Which signs indicate an auxiliary system malfunction (e.g., alternator, fan)?", options: { a: "Unusual noises and vibration", b: "Warning lights and loss of power", c: "Both a and b", d: "No signs until failure" }, correct: "c" },
        { q: "Which two senses help identify brake fade?", options: { a: "Sight and smell", b: "Smell and feeling (spongy pedal)", c: "Hearing and warning light" }, correct: "b" },
        { q: "What are common signs of a failing drive shaft?", options: { a: "Clunking sounds and vibration", b: "Excessive smoke", c: "Low coolant light" }, correct: "a" },
        { q: "If the tractor leans to one side, which system is likely at fault?", options: { a: "Leaf spring suspension", b: "Transmission", c: "Fuel system" }, correct: "a" },
        { q: "If you do not hear a click when coupling, what might be wrong?", options: { a: "Locking jaws did not close", b: "Tires are flat", c: "Brake lights are out" }, correct: "a" },
        { q: "What level of inspection is a walk-around driver/vehicle inspection?", options: { a: "Level 1", b: "Level 2", c: "Level 3" }, correct: "b" },
        { q: "Does a standard Pre-Trip Inspection help you pass a roadside inspection?", options: { a: "Yes, it finds items inspectors would catch", b: "No, it is unrelated", c: "Only sometimes" }, correct: "a" },
        { q: "If placed out-of-service, can you legally move the vehicle?", options: { a: "No", b: "Yes", c: "Yes, but only if you worked less than 11 hours" }, correct: "a" },
        { q: "Why perform preventive maintenance on equipment?", options: { a: "Extend service life and prevent breakdowns", b: "Only to satisfy paperwork", c: "To increase fuel use" }, correct: "a" },
        { q: "Which documents should be kept for FMCSA investigations?", options: { a: "Roadside inspection reports and DVIRs", b: "Only fuel receipts", c: "Personal notes" }, correct: "a" },
        { q: "Who is responsible for basic vehicle maintenance knowledge?", options: { a: "Drivers should know how to maintain CMVs", b: "Only mechanics need to know", c: "No one needs to know" }, correct: "a" },
        { q: "If a component has reached service life but not failed, you should:", options: { a: "Replace it as preventive maintenance", b: "Wait until it fails", c: "Ignore it" }, correct: "a" },
        { q: "If a vehicle is placed out-of-service for a defect, the correct action is to:", options: { a: "Move it immediately", b: "Fix the defect or get authorization before moving", c: "Drive slowly home" }, correct: "b" },
        { q: "After disconnecting air and electrical lines, what should you do with them?", options: { a: "Leave them on the ground", b: "Support them so they won't be damaged", c: "Tie them to the bumper" }, correct: "b" },
        { q: "When unlocking the fifth wheel during uncoupling, you must keep clear of tractor wheels because:", options: { a: "Legs and feet can be crushed if wheels move", b: "It is more comfortable", c: "It helps balance the trailer" }, correct: "a" },
        { q: "Before pulling the tractor clear of the trailer, you must ensure the landing gear is stable. Why?", options: { a: "To prevent the trailer from falling if gear collapses", b: "To save time", c: "To avoid paperwork" }, correct: "a" },
        { q: "Which of the following should be inspected when uncoupling a trailer?", options: { a: "Ground support and landing gear condition", b: "Only the tires", c: "Only the lights" }, correct: "a" }
      ]},
      5: { title: "Non-Driving Activities", questions: [
        { q: "If you fail to keep your medical certificate current, what can happen to your CDL?", options: { a: "It may be suspended", b: "Nothing happens", c: "You get a warning only" }, correct: "a" },
        { q: "Should you hide prescription medications from a DOT examiner?", options: { a: "Yes", b: "No", c: "Only if they are minor" }, correct: "b" },
        { q: "As a professional driver, who is responsible for cargo safety?", options: { a: "The driver", b: "Only the loader", c: "The shipper" }, correct: "a" },
        { q: "Why is it important to keep cargo low and centered?", options: { a: "To lower center of gravity and improve stability", b: "To make loading faster", c: "To increase fuel consumption" }, correct: "a" },
        { q: "How often must you have a tie-down for cargo?", options: { a: "At least one every 5 feet", b: "At least one every 10 feet", c: "Only at the ends" }, correct: "b" },
        { q: "What is the purpose of a header board on a flatbed trailer?", options: { a: "Protect the cab from shifting cargo", b: "Block wind when reversing", c: "Hold paperwork" }, correct: "a" },
        { q: "Before pulling out of a dock, you should:", options: { a: "Visually check the dock area for people and obstructions", b: "Rely on the dock worker to be clear", c: "Back out quickly" }, correct: "a" },
        { q: "If you have a major engine oil leak, the correct action is:", options: { a: "Keep driving and add oil", b: "Stop and repair or report before continuing", c: "Ignore it" }, correct: "b" },
        { q: "Where should you look for emergency response information for hazardous materials?", options: { a: "Emergency Response Guidebook (ERG)", b: "Internet forums", c: "Ask a coworker" }, correct: "a" },
        { q: "Interstate commerce means:", options: { a: "Traveling between states", b: "Staying within one state", c: "Only international travel" }, correct: "a" },
        { q: "Intrastate commerce means:", options: { a: "Operating within a single state", b: "Crossing state lines", c: "International transport" }, correct: "a" },
        { q: "Can you use a commercial vehicle for personal use and ignore federal HOS rules?", options: { a: "Yes", b: "No", c: "Only on weekends" }, correct: "b" },
        { q: "How many hours can you work in a 7-day period under common HOS rules (example)?", options: { a: "60 hours", b: "70 hours", c: "80 hours" }, correct: "a" },
        { q: "Should you secure cargo to prevent shifting during transport?", options: { a: "Yes", b: "No", c: "Only for heavy loads" }, correct: "a" },
        { q: "Which documents are important for EPA and cargo compliance?", options: { a: "Shipping papers and manifests", b: "Only fuel receipts", c: "Personal notes" }, correct: "a" },
        { q: "If you are fatigued, the best action is to:", options: { a: "Take a break or sleep before continuing", b: "Drink coffee and keep driving", c: "Open windows and drive on" }, correct: "a" },
        { q: "Which of the following helps manage fatigue on long trips?", options: { a: "Regular rest breaks and sleep", b: "Energy drinks only", c: "Skipping meals" }, correct: "a" },
        { q: "After a crash with injuries, you should first:", options: { a: "Ensure safety and call emergency services", b: "Move the vehicles immediately", c: "Leave the scene" }, correct: "a" },
        { q: "When communicating externally after an incident, you should:", options: { a: "Follow company procedures and report facts", b: "Speculate about causes", c: "Post on social media" }, correct: "a" },
        { q: "Whistleblowing protections mean you should:", options: { a: "Report safety violations without fear of retaliation", b: "Never report anything", c: "Only report to coworkers" }, correct: "a" },
        { q: "Trip planning should include:", options: { a: "Route, rest stops, fuel, and legal restrictions", b: "Only the fastest route", c: "No planning needed" }, correct: "a" },
        { q: "If you suspect a driver is under the influence, you should:", options: { a: "Report to your supervisor or authorities", b: "Ignore it", c: "Confront them aggressively" }, correct: "a" },
        { q: "Medical requirements for drivers include:", options: { a: "Keeping medical certificate current and reporting disqualifying conditions", b: "Only reporting if asked", c: "No medical checks" }, correct: "a" },
        { q: "Which is a correct practice for Post-Trip vehicle checks?", options: { a: "Record defects and report them immediately", b: "Fix them later at home", c: "Ignore minor defects" }, correct: "a" },
        { q: "How should you handle cargo that shifts during a trip?", options: { a: "Stop at a safe place and resecure the load", b: "Drive faster to the destination", c: "Ignore until arrival" }, correct: "a" },
        { q: "Which is required for transporting hazardous materials?", options: { a: "Proper shipping papers and placards", b: "Only verbal instructions", c: "No documentation" }, correct: "a" },
        { q: "If you discover a maintenance issue during a trip, you should:", options: { a: "Report it and take corrective action before continuing", b: "Continue and report later", c: "Hide it" }, correct: "a" },
        { q: "Which is a sign you should not drive: excessive drowsiness, blurred vision, or chest pain?", options: { a: "No — keep driving", b: "Yes — do not drive and seek help", c: "Only if severe" }, correct: "b" },
        { q: "Are you required to follow company policies for cargo securement and EPA rules?", options: { a: "No", b: "Yes", c: "Only sometimes" }, correct: "b" },
        { q: "What should you do if you are unsure about Hours-Of-Service rules for a trip?", options: { a: "Ignore them", b: "Guess based on experience", c: "Check company policy and federal rules before driving" }, correct: "c" },
        { q: "If a post-crash inspection is required, who usually performs it?", options: { a: "Qualified inspector or authorized personnel", b: "Any passerby", c: "Only the driver without documentation" }, correct: "a" },
        { q: "Which action helps reduce risk of DUI while on duty?", options: { a: "Avoid alcohol before and during duty periods", b: "Drink small amounts and drive", c: "Rely on coffee" }, correct: "a" },
        { q: "If a driver has a disqualifying medical condition, they must:", options: { a: "Report it and stop driving until cleared", b: "Keep driving and hide it", c: "Only tell a coworker" }, correct: "a" },
        { q: "Which is part of good trip planning for compliance?", options: { a: "Check weight limits, permits, and rest stops", b: "Only plan fuel stops", c: "Ignore permits" }, correct: "a" },
        { q: "When should you complete required paperwork for cargo and HOS?", options: { a: "Only at the end of the week", b: "Before and during the trip as required", c: "Never" }, correct: "b" },
        { q: "If you witness unsafe behavior by a coworker, you should:", options: { a: "Report it through proper channels", b: "Ignore it", c: "Retaliate" }, correct: "a" },
        { q: "Which of the following supports driver wellness?", options: { a: "Regular sleep, healthy meals, and exercise", b: "Skipping sleep to meet schedules", c: "Caffeine" }, correct: "a" },
        { q: "If a DOT medical examiner asks about medications, you should:", options: { a: "Disclose all prescriptions and over-the-counter drugs", b: "Hide them", c: "Only mention illegal drugs" }, correct: "a" },
        { q: "Are drivers required to follow EPA rules for idling and emissions where applicable?", options: { a: "Only in some states", b: "No", c: "Yes" }, correct: "c" },
        { q: "Which is the correct response to a cargo spill involving hazardous material?", options: { a: "Secure the area and follow ERG and company procedures", b: "Call 911", c: "Ask for help" }, correct: "a" }
      ]}
    };

    // Count total questions for verification
    let totalQuestionsInRegistry = 0;
    Object.keys(quizRegistry).forEach(sectionId => {
      totalQuestionsInRegistry += quizRegistry[sectionId].questions.length;
    });
    console.log(`📊 Total questions in registry: ${totalQuestionsInRegistry}`);

    // Begin transaction to ensure data integrity
    await db.query('BEGIN');

    try {
      // 1. Delete all existing quiz questions and choices
      console.log(`🗑️ Deleting all existing quiz questions and choices...`);
      await db.query('DELETE FROM quiz_multiple_choices WHERE active = true');
      await db.query('DELETE FROM quiz_questions WHERE active = true');
      console.log(`✅ Deleted existing questions and choices`);

      // 2. Get all quiz IDs for the sections
      const quizResult = await db.query(`
        SELECT id, section_id FROM quizes WHERE active = true ORDER BY section_id
      `);
      
      if (quizResult.rows.length === 0) {
        throw new Error('No quizes found in database');
      }

      // 3. Insert all questions from quizRegistry
      let questionOrder = 1;
      let totalInserted = 0;

      for (const [sectionId, sectionData] of Object.entries(quizRegistry)) {
        const quiz = quizResult.rows.find(q => q.section_id === parseInt(sectionId));
        if (!quiz) {
          console.log(`⚠️ No quiz found for section ${sectionId}`);
          continue;
        }

        console.log(`📝 Processing section ${sectionId}: ${sectionData.title} (${sectionData.questions.length} questions)`);

        for (const [index, questionData] of sectionData.questions.entries()) {
          // Insert question
          const questionResult = await db.query(`
            INSERT INTO quiz_questions (quiz_id, question_name, modified_by, active)
            VALUES ($1, $2, 'system', true)
            RETURNING id
          `, [quiz.id, questionData.q]);

          const questionId = questionResult.rows[0].id;

          // Insert multiple choice options
          for (const [optionKey, optionText] of Object.entries(questionData.options)) {
            const isCorrect = optionKey === questionData.correct;
            await db.query(`
              INSERT INTO quiz_multiple_choices (question_id, choice_name, choice_description, is_correct, modified_by, active)
              VALUES ($1, $2, $3, $4, 'system', true)
            `, [questionId, optionKey, optionText, isCorrect]);
          }

          totalInserted++;
        }
        
        console.log(`✅ Inserted ${sectionData.questions.length} questions for section ${sectionId}`);
      }

      // Commit transaction
      await db.query('COMMIT');
      
      console.log(`🎉 REPOPULATION COMPLETE!`);
      console.log(`   📊 Total questions inserted: ${totalInserted}`);
      console.log(`   ✅ Expected: ${totalQuestionsInRegistry}`);
      console.log(`   🎯 Match: ${totalInserted === totalQuestionsInRegistry ? 'YES' : 'NO'}`);

      res.json({
        success: true,
        message: `Successfully repopulated all quiz questions`,
        totalInserted,
        expectedTotal: totalQuestionsInRegistry,
        sectionsProcessed: Object.keys(quizRegistry).length
      });

    } catch (error) {
      // Rollback on error
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error(`💥 Error repopulating questions:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to repopulate quiz questions',
      details: error.message
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

    await ensureProgressTrackerTable();

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

// Data migration function to convert array-index answers to question-ID format
async function migrateAnswerFormat() {
  try {
    console.log('🔄 Checking for answer format migration...');
    
    // Get all progress records that might need migration
    const progressRecords = await db.query(`
      SELECT id, quiz_id, user_answers 
      FROM user_quiz_progress_tracker 
      WHERE user_answers IS NOT NULL 
      AND jsonb_typeof(user_answers) = 'object'
    `);
    
    let migratedCount = 0;
    
    for (const record of progressRecords.rows) {
      const userAnswers = record.user_answers;
      const keys = Object.keys(userAnswers);
      
      // Check if this record uses array indices (all keys are numeric and small)
      const hasArrayIndices = keys.length > 0 && keys.every(key => 
        /^\d+$/.test(key) && parseInt(key) < 100 // Assuming question IDs are > 100
      );
      
      if (hasArrayIndices) {
        console.log(`🔄 Migrating quiz ${record.quiz_id} answers from array indices to question IDs...`);
        
        // Get question mapping for this quiz
        const questionMapping = await db.query(`
          SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 as array_index
          FROM quiz_questions 
          WHERE quiz_id = $1 AND active = true 
          ORDER BY id
        `, [record.quiz_id]);
        
        // Convert answers
        const newAnswers = {};
        questionMapping.rows.forEach(question => {
          const arrayIndex = question.array_index.toString();
          if (userAnswers[arrayIndex]) {
            newAnswers[question.id.toString()] = userAnswers[arrayIndex];
          }
        });
        
        // Update the record if we have new answers
        if (Object.keys(newAnswers).length > 0) {
          await db.query(`
            UPDATE user_quiz_progress_tracker 
            SET user_answers = $1 
            WHERE id = $2
          `, [JSON.stringify(newAnswers), record.id]);
          
          migratedCount++;
          console.log(`✅ Migrated quiz ${record.quiz_id}: ${Object.keys(userAnswers).length} answers converted`);
        }
      }
    }
    
    if (migratedCount > 0) {
      console.log(`🎉 Migration completed: ${migratedCount} records updated to use question IDs`);
    } else {
      console.log('✅ No migration needed - all answers already use consistent format');
    }
    
  } catch (error) {
    console.error('❌ Migration error:', error.message);
  }
}

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Mailgun Domain: ${process.env.MAILGUN_DOMAIN || 'Not configured'}`);
  console.log(`Mailgun API Key: ${process.env.MAILGUN_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`Recipient Email: ${process.env.RECIPIENT_EMAIL || 'Using default: info@brooklyncdl.com'}`);
  
  // Run data migration on server startup
  await migrateAnswerFormat();
});

module.exports = {
  app,
  calculateCourseProgressSummary
};

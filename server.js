const express = require('express');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Add request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${req.method} ${req.url}`);
  
  if (req.method !== 'GET') {
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Mailgun Domain: ${process.env.MAILGUN_DOMAIN || 'Not configured'}`);
  console.log(`Mailgun API Key: ${process.env.MAILGUN_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`Recipient Email: ${process.env.RECIPIENT_EMAIL || 'Using default: info@brooklyncdl.com'}`);
});

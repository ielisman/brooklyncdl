const express = require('express');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Email endpoint that uses server-side environment variables
app.post('/api/send-email', async (req, res) => {
  try {
    const { htmlContent, textContent, subject } = req.body;

    // Get environment variables (secure server-side access)
    const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
    const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
    const MAILGUN_API_URL = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;
    const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'info@brooklyncdl.com';

    // Validate required environment variables
    if (!MAILGUN_DOMAIN || !MAILGUN_API_KEY) {
      return res.status(500).json({ 
        error: 'Missing Mailgun configuration. Please check environment variables.' 
      });
    }

    // Create form data for Mailgun API
    const formData = new FormData();
    formData.append('from', `Brooklyn CDL ELDT <noreply@${MAILGUN_DOMAIN}>`);
    formData.append('to', RECIPIENT_EMAIL);
    formData.append('subject', subject || 'ELDT Score Submission');
    formData.append('html', htmlContent);
    formData.append('text', textContent);

    // Send email via Mailgun
    const response = await fetch(MAILGUN_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('api:' + MAILGUN_API_KEY).toString('base64'),
        ...formData.getHeaders()
      },
      body: formData
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Email sent successfully:', result);
      res.json({ success: true, message: 'Email sent successfully!', data: result });
    } else {
      const error = await response.text();
      console.error('Failed to send email:', error);
      res.status(400).json({ success: false, error: 'Failed to send email', details: error });
    }

  } catch (error) {
    console.error('Server error sending email:', error);
    res.status(500).json({ success: false, error: 'Server error sending email' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Mailgun Domain: ${process.env.MAILGUN_DOMAIN || 'Not configured'}`);
});

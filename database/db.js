// Database configuration for Brooklyn CDL ELDT Platform
const { Pool } = require('pg');
require('dotenv').config();

// Debug environment variables
console.log('Environment check:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PASSWORD length:', process.env.DB_PASSWORD ? process.env.DB_PASSWORD.length : 'undefined');
console.log('DB_PORT:', process.env.DB_PORT);

// Handle special characters in password
const rawPassword = process.env.DB_PASSWORD;
console.log('Raw password type:', typeof rawPassword);
console.log('Raw password value check:', rawPassword ? 'has value' : 'empty/undefined');

// Ensure password is properly handled as a string
const dbConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'brooklyncdl_eldt',
  password: rawPassword || '',
  port: parseInt(process.env.DB_PORT) || 5432,
  ssl: false,
  // Add connection timeout and retry settings
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 20
};

console.log('Final database config:', {
  user: dbConfig.user,
  host: dbConfig.host,
  database: dbConfig.database,
  password: dbConfig.password ? `[${dbConfig.password.length} chars]` : '[EMPTY]',
  port: dbConfig.port
});

const pool = new Pool(dbConfig);

// Test database connection
pool.on('connect', (client) => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err.message);
  console.error('Full error:', err);
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error acquiring client:', err.message);
    console.error('Error stack:', err.stack);
    return;
  }
  console.log('Database connection test successful');
  release();
});

module.exports = {
  pool,
  query: (text, params) => {
    console.log('Executing query:', text.substring(0, 50) + '...');
    return pool.query(text, params);
  }
};
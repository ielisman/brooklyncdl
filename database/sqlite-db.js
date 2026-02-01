// SQLite Database Connection for Development
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'brooklyncdl.sqlite');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    
    // Enable foreign key constraints
    db.run('PRAGMA foreign_keys = ON');
  }
});

// Wrapper to provide promise-based interface similar to pg
const dbWrapper = {
  query: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      if (sql.trim().toLowerCase().startsWith('select')) {
        db.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve({ rows, rowCount: rows.length });
          }
        });
      } else {
        db.run(sql, params, function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
          }
        });
      }
    });
  }
};

module.exports = dbWrapper;
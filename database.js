// database.js
const sqlite3 = require('sqlite3').verbose();
const dbPath = 'bot_database.db';

// Initialize database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database error:', err.message);
  else console.log('Connected to SQLite database.');
});

// Create files table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    message_link TEXT
  )`);
});

// Save file metadata to database
function saveFile(userId, filename, filePath, messageLink = null) {
  return new Promise((resolve, reject) => {
    try {
      const stmt = db.prepare(
        `INSERT INTO files (user_id, filename, file_path, message_link)
         VALUES (?, ?, ?, ?)`
      );
      stmt.run(userId, filename, filePath, messageLink, (err) => {
        if (err) {
          reject(err);
        } else {
          stmt.finalize();
          console.log(`Saved file: ${filename}`);
          resolve(`Saved file: ${filename}`);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Search files by keyword
function searchFiles(keyword, limit = 5) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM files 
       WHERE filename LIKE ? OR user_id LIKE ? 
       ORDER BY upload_time DESC LIMIT ?`,
      [`%${keyword}%`, `%${keyword}%`, limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

module.exports = { saveFile, searchFiles };
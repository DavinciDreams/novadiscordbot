// utils.js
const fs = require('fs');
const path = require('path');

const FILE_STORAGE_PATH = 'file_storage';

// Ensure storage directory exists
function ensureStorageDir() {
  if (!fs.existsSync(FILE_STORAGE_PATH)) {
    fs.mkdirSync(FILE_STORAGE_PATH);
  }
}

// Save file to disk
async function saveFileToDisk(attachment, filename) {
  ensureStorageDir();
  const filePath = path.join(FILE_STORAGE_PATH, filename);
  const response = await fetch(attachment.url);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

module.exports = { saveFileToDisk };
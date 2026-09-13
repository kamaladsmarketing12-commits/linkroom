const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/prettylink.db';

// Ensure the containing directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log(`Migrated schema on ${DB_PATH}`);
}

// Run directly: `node src/db.js --migrate`
if (require.main === module && process.argv.includes('--migrate')) {
  require('dotenv').config();
  migrate();
}

module.exports = { db, migrate };

// Usage: node src/create-admin.js "your-password-here"
// Prints an ADMIN_PASSWORD_HASH line to paste into your .env file.
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node src/create-admin.js "your-password"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log('\nAdd this to your .env file:\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);

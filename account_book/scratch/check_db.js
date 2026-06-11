const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

async function main() {
  const dbPath = path.join(__dirname, '..', 'data', 'account_book_admin.db');
  console.log('Opening DB:', dbPath);
  try {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    const categories = await db.all('SELECT * FROM categories');
    console.log('Categories in DB:');
    console.log(JSON.stringify(categories, null, 2));
  } catch (e) {
    console.error('Error:', e);
  }
}

main();

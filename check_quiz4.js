const { Client } = require('pg');

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'brooklyncdl_eldt',
  password: process.env.DB_PASSWORD || 'IBMpostgres15',
  port: 5432
});

client.connect().then(async () => {
  console.log('Checking quiz progress for user 1...');
  const result = await client.query('SELECT quiz_id, user_answers FROM user_quiz_progress_tracker WHERE user_id = 1 ORDER BY quiz_id');
  console.log('Quiz Progress Data:');
  result.rows.forEach(row => {
    console.log(`Quiz ${row.quiz_id}: ${JSON.stringify(row.user_answers)}`);
  });
  await client.end();
}).catch(console.error);
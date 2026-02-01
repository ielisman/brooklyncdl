const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',  
  database: 'brooklyncdl_eldt',
  password: 'Ilovemyson@0312',
  port: 5432
});

async function debugData() {
  try {
    // Get user answers for first quiz
    const progressResult = await pool.query(`
      SELECT user_answers, quiz_id 
      FROM user_quiz_progress_tracker 
      WHERE user_id = 1 AND user_answers IS NOT NULL 
      LIMIT 1
    `);
    
    console.log('User answers from DB:', progressResult.rows[0]);
    
    if (progressResult.rows.length > 0) {
      const { user_answers, quiz_id } = progressResult.rows[0];
      
      // Get first few questions from that quiz  
      const questionsResult = await pool.query(`
        SELECT id, question_name 
        FROM quiz_questions 
        WHERE quiz_id = $1 
        ORDER BY id 
        LIMIT 10
      `, [quiz_id]);
      
      console.log('\nQuestion IDs in DB:');
      questionsResult.rows.forEach(q => {
        console.log(`  ID ${q.id}: ${q.question_name.substring(0, 50)}...`);
      });
      
      // Get correct answers for those questions
      const correctResult = await pool.query(`
        SELECT qq.id, qmc.choice_name 
        FROM quiz_questions qq 
        JOIN quiz_multiple_choices qmc ON qq.id = qmc.question_id 
        WHERE qq.quiz_id = $1 AND qmc.is_correct = true 
        ORDER BY qq.id 
        LIMIT 10
      `, [quiz_id]);
      
      console.log('\nCorrect answers:');
      correctResult.rows.forEach(c => {
        console.log(`  Question ID ${c.id}: Correct answer is "${c.choice_name}"`);
      });
      
      // Show what the user answered
      console.log('\nUser answers analysis:');
      if (user_answers && typeof user_answers === 'object') {
        Object.keys(user_answers).forEach(key => {
          console.log(`  Key "${key}": User answered "${user_answers[key]}"`);
        });
      }
    }
    
    pool.end();
  } catch (error) {
    console.error('Error:', error);
    pool.end();
  }
}

debugData();
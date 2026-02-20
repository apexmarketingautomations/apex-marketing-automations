import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Optional: test connection
pool.query('SELECT NOW()')
  .then(res => console.log('DB Connected:', res.rows))
  .catch(err => console.error('DB Connection Error:', err));

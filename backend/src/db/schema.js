import bcrypt from 'bcryptjs';
import { query } from './pool.js';

const seedUsers = [
  { username: 'admin', displayName: '系统管理员', role: 'admin', jobTitle: '经理', department: '研发部' }
];

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
      job_title TEXT NOT NULL DEFAULT '技术员',
      department_id INTEGER NOT NULL REFERENCES departments(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS memos (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#4f7cff',
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      due_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '技术员'
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_memos_owner_date ON memos(owner_id, date)');
  await query('CREATE INDEX IF NOT EXISTS idx_memos_date ON memos(date)');
  await query('CREATE INDEX IF NOT EXISTS idx_memos_date_owner_id ON memos(date, owner_id, id)');
  await query('CREATE INDEX IF NOT EXISTS idx_memos_updated_at ON memos(updated_at)');
  await query('CREATE INDEX IF NOT EXISTS idx_memos_completed ON memos(completed)');
  await query('CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_users_job_title ON users(job_title)');

  await query(
    `INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO NOTHING`,
    ['研发部']
  );

  await query(
    `
    UPDATE users
    SET department_id = target.id
    FROM departments current, departments target
    WHERE users.department_id = current.id
      AND current.name = '办公室'
      AND target.name = '研发部'
    `
  );

  await query(
    `
    DELETE FROM departments
    WHERE name = '办公室'
      AND NOT EXISTS (
        SELECT 1 FROM users WHERE users.department_id = departments.id
      )
    `
  );

  const passwordHash = await bcrypt.hash('0000', 10);

  for (const user of seedUsers) {
    await query(
      `
      INSERT INTO users(username, password_hash, display_name, role, job_title, department_id)
      SELECT $1, $2, $3, $4, $5, departments.id
      FROM departments
      WHERE departments.name = $6
      ON CONFLICT(username) DO NOTHING
      `,
      [user.username, passwordHash, user.displayName, user.role, user.jobTitle, user.department]
    );
  }

  await query(
    `
    UPDATE users
    SET job_title = seed.job_title
    FROM (VALUES
      ('admin', '经理')
    ) AS seed(username, job_title)
    WHERE users.username = seed.username
    `
  );

  await query(
    `
    UPDATE users
    SET job_title = '技术员'
    WHERE username <> 'admin' AND job_title = '经理'
    `
  );

  await query(
    `
    UPDATE users
    SET role = 'staff'
    WHERE username <> 'admin' AND role = 'manager'
    `
  );

  await query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
  await query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'staff'))
  `);

}
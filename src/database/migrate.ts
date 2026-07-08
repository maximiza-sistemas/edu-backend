import { query, checkConnection } from '../config/database.js';

/**
 * Safe SQL schema - embedded directly in code to avoid any dependency 
 * on external schema.sql files that might be outdated/cached.
 * Uses CREATE TABLE IF NOT EXISTS - completely non-destructive.
 */
const SAFE_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'professor', 'student')),
    avatar VARCHAR(512),
    professor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    class_group VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_professor_id ON users(professor_id) WHERE professor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_class_group ON users(class_group) WHERE class_group IS NOT NULL;

-- Books table
CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) NOT NULL,
    description TEXT,
    cover_url VARCHAR(512),
    pdf_url VARCHAR(512),
    curriculum_component VARCHAR(50) NOT NULL,
    book_type VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (book_type IN ('student', 'professor')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_books_curriculum ON books(curriculum_component);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

-- N:N relationship between books and class groups
CREATE TABLE IF NOT EXISTS book_class_groups (
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    class_group VARCHAR(20) NOT NULL,
    PRIMARY KEY (book_id, class_group)
);

CREATE INDEX IF NOT EXISTS idx_book_class_groups_class ON book_class_groups(class_group);

-- Levels table (paralelo às séries, para o mundo dos níveis)
CREATE TABLE IF NOT EXISTS levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Book assignments
CREATE TABLE IF NOT EXISTS book_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    UNIQUE(book_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_book ON book_assignments(book_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON book_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_progress ON book_assignments(progress);

-- Trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_books_updated_at ON books;
CREATE TRIGGER update_books_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Coluna de nível no livro (NULL = livro do mundo dos anos)
ALTER TABLE books ADD COLUMN IF NOT EXISTS level VARCHAR(100);

-- Ampliar perfis permitidos para incluir 'niveis' (recria a regra, não apaga dados)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'professor', 'student', 'niveis'));
`;

/**
 * Safe database migration - ensures tables exist WITHOUT destroying data.
 * This runs on every server startup and is idempotent.
 * SQL is embedded directly in code - no external file dependency.
 */
export async function ensureTables(): Promise<void> {
    console.log('📦 Running safe database migration (embedded SQL)...');
    console.log('⚠️  Using CREATE TABLE IF NOT EXISTS - existing data will NOT be deleted');

    const connected = await checkConnection();
    if (!connected) {
        throw new Error('Cannot run migration: database not connected');
    }

    await query(SAFE_SCHEMA);
    console.log('✅ Tables ensured (existing data preserved)');
}

/**
 * Check if the database has any users (indicates first-time setup).
 */
export async function isDatabaseEmpty(): Promise<boolean> {
    try {
        const result = await query('SELECT COUNT(*) as count FROM users');
        const count = parseInt(result.rows[0].count);
        console.log(`📊 Database user count: ${count}`);
        return count === 0;
    } catch {
        console.log('📊 Users table not found - database is empty');
        return true;
    }
}

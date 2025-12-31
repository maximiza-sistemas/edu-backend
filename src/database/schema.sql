-- Educação Maxi Database Schema
-- PostgreSQL Schema for Learning Management System

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS book_assignments CASCADE;
DROP TABLE IF EXISTS book_class_groups CASCADE;
DROP TABLE IF EXISTS books CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table
CREATE TABLE users (
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

-- Users indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_professor_id ON users(professor_id) WHERE professor_id IS NOT NULL;
CREATE INDEX idx_users_class_group ON users(class_group) WHERE class_group IS NOT NULL;

-- Books table
CREATE TABLE books (
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

-- Books indexes
CREATE INDEX idx_books_curriculum ON books(curriculum_component);
CREATE INDEX idx_books_title ON books(title);

-- N:N relationship between books and class groups
CREATE TABLE book_class_groups (
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    class_group VARCHAR(20) NOT NULL,
    PRIMARY KEY (book_id, class_group)
);

-- Book class groups index
CREATE INDEX idx_book_class_groups_class ON book_class_groups(class_group);

-- Book assignments (user-book relationships with progress)
CREATE TABLE book_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    UNIQUE(book_id, user_id)
);

-- Assignments indexes
CREATE INDEX idx_assignments_book ON book_assignments(book_id);
CREATE INDEX idx_assignments_user ON book_assignments(user_id);
CREATE INDEX idx_assignments_progress ON book_assignments(progress);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_books_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

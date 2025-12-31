// Migration to add book_type column
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function migrate() {
    try {
        console.log('Adding book_type column to books table...');

        // Check if column already exists
        const checkResult = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'books' AND column_name = 'book_type'
        `);

        if (checkResult.rows.length > 0) {
            console.log('Column book_type already exists, skipping migration.');
        } else {
            await pool.query(`
                ALTER TABLE books 
                ADD COLUMN book_type VARCHAR(20) NOT NULL DEFAULT 'student' 
                CHECK (book_type IN ('student', 'professor'))
            `);
            console.log('Column book_type added successfully!');
        }

        // Verify the column
        const verifyResult = await pool.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns 
            WHERE table_name = 'books' AND column_name = 'book_type'
        `);
        console.log('Verification:', verifyResult.rows[0]);

    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        await pool.end();
    }
}

migrate();

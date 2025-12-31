// Migration to add series table
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function migrate() {
    try {
        console.log('Creating series table...');

        // Check if table already exists
        const checkResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'series'
        `);

        if (checkResult.rows.length > 0) {
            console.log('Table series already exists, skipping creation.');
        } else {
            await pool.query(`
                CREATE TABLE series (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(100) NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Table series created successfully!');

            // Add some default series
            await pool.query(`
                INSERT INTO series (name) VALUES 
                ('1º Ano'),
                ('2º Ano'),
                ('3º Ano'),
                ('4º Ano'),
                ('5º Ano'),
                ('6º Ano'),
                ('7º Ano'),
                ('8º Ano'),
                ('9º Ano')
                ON CONFLICT (name) DO NOTHING
            `);
            console.log('Default series added!');
        }

        // Verify
        const verifyResult = await pool.query('SELECT * FROM series ORDER BY name');
        console.log('Current series:', verifyResult.rows);

    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        await pool.end();
    }
}

migrate();

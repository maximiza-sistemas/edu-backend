const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkUsers() {
    try {
        const result = await pool.query('SELECT id, name, email, role FROM users');
        console.log('Users in database:');
        console.log(result.rows);

        const admins = result.rows.filter(u => u.role === 'admin');
        console.log('\nAdmin users:', admins);

        if (admins.length === 0) {
            console.log('\nNo admin users found!');
        }
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkUsers();

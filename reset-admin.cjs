const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function resetAdmin() {
    try {
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        console.log('Updating admin password...');
        console.log('Hash:', hashedPassword);

        const result = await pool.query(
            "UPDATE users SET password_hash = $1 WHERE role = 'admin'",
            [hashedPassword]
        );

        console.log('Updated rows:', result.rowCount);

        // Also check if admin exists
        const check = await pool.query("SELECT id, email, role FROM users WHERE role = 'admin'");
        console.log('Admin users:', check.rows);

        console.log('\n✅ Login credentials:');
        console.log('   Email: admin@maxieducacao.com');
        console.log('   Password: admin123');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

resetAdmin();

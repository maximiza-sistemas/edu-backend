import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createOrUpdateAdmin() {
    try {
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Check if admin exists
        const existing = await pool.query(
            "SELECT id, email, password_hash FROM users WHERE email = 'admin@maxieducacao.com'"
        );

        if (existing.rows.length > 0) {
            console.log('Admin exists. Updating password to: admin123');
            await pool.query(
                "UPDATE users SET password_hash = $1 WHERE email = 'admin@maxieducacao.com'",
                [hashedPassword]
            );
            console.log('Password updated successfully!');
        } else {
            console.log('Creating new admin user...');
            await pool.query(
                `INSERT INTO users (name, email, password_hash, role) 
                 VALUES ('Administrador', 'admin@maxieducacao.com', $1, 'admin')`,
                [hashedPassword]
            );
            console.log('Admin user created!');
        }

        console.log('\n✅ Login credentials:');
        console.log('   Email: admin@maxieducacao.com');
        console.log('   Password: admin123');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

createOrUpdateAdmin();

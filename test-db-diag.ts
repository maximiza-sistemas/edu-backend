
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Explicitly load from current directory
console.log('Loading .env from:', path.resolve(process.cwd(), '.env'));
const result = dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (result.error) {
    console.error('Error loading .env:', result.error);
}

const dbUrl = process.env.DATABASE_URL;
console.log('DB URL (masked):', dbUrl?.replace(/:([^:@]+)@/, ':****@'));

if (!dbUrl) {
    console.error('DATABASE_URL is missing!');
    process.exit(1);
}

// Test 1: SSL Disable (as per .env)
async function testConnection(name: string, ssl: any) {
    console.log(`\n--- Testing ${name} ---`);
    const pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 5000,
        ssl: ssl
    });

    try {
        const client = await pool.connect();
        console.log(`✅ ${name} Success!`);
        const res = await client.query('SELECT version()');
        console.log('Version:', res.rows[0].version);
        client.release();
    } catch (err: any) {
        console.error(`❌ ${name} Failed:`, err.message);
        if (err.code) console.error('Error Code:', err.code);
    } finally {
        await pool.end();
    }
}

async function run() {
    // Original config (likely sslmode=disable in URL overrides this, but let's see)
    // If URL has sslmode=disable, pg driver might ignore the object config or vice versa.
    // Let's force override by parsing URL or passing object.

    // Test 0: Exact Env String
    console.log('Test 0: Using exact connection string from env');
    await testConnection('Default (Env)', undefined);

    // Test 1: Force No SSL (explicit object)
    // Note: To force no SSL, we might need to remove sslmode from URL if it conflicts
    // But let's verify if 'ssl: false' works.
}

run();

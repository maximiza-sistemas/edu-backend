import { query, checkConnection } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Safe database migration - ensures tables exist WITHOUT destroying data.
 * This runs on every server startup and is idempotent.
 * Uses CREATE TABLE IF NOT EXISTS (defined in schema.sql).
 */
export async function ensureTables(): Promise<void> {
    console.log('📦 Running safe database migration...');

    const connected = await checkConnection();
    if (!connected) {
        throw new Error('Cannot run migration: database not connected');
    }

    // Read the safe schema (CREATE TABLE IF NOT EXISTS)
    // Try multiple paths for compatibility with different execution contexts
    let schema: string;
    const possiblePaths = [
        join(process.cwd(), 'dist', 'database', 'schema.sql'),
        join(process.cwd(), 'src', 'database', 'schema.sql'),
    ];

    let loaded = false;
    for (const schemaPath of possiblePaths) {
        try {
            schema = readFileSync(schemaPath, 'utf-8');
            loaded = true;
            console.log(`  ✅ Schema loaded from: ${schemaPath}`);
            break;
        } catch {
            // Try next path
        }
    }

    if (!loaded) {
        throw new Error(`Schema file not found in any of: ${possiblePaths.join(', ')}`);
    }

    // Execute the safe schema (CREATE TABLE IF NOT EXISTS)
    await query(schema!);
    console.log('  ✅ Tables ensured (existing data preserved)');
}

/**
 * Check if the database has any users (indicates first-time setup).
 */
export async function isDatabaseEmpty(): Promise<boolean> {
    try {
        const result = await query('SELECT COUNT(*) as count FROM users');
        return parseInt(result.rows[0].count) === 0;
    } catch {
        // Table doesn't exist yet, so database is "empty"
        return true;
    }
}

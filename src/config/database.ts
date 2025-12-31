import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Connection pool with optimized settings to avoid CPU overload
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,                      // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,     // Close idle clients after 30 seconds
    connectionTimeoutMillis: 5000, // Return error after 5 seconds if connection not established
});

// Log pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

// Generic query function with connection release
export async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
): Promise<QueryResult<T>> {
    const start = Date.now();
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    // Log slow queries (> 100ms) for optimization
    if (duration > 100) {
        console.warn('Slow query:', { text, duration, rows: result.rowCount });
    }

    return result;
}

// Transaction helper with automatic rollback on error
export async function withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Get a client for complex operations
export async function getClient(): Promise<PoolClient> {
    return pool.connect();
}

// Check database connection
export async function checkConnection(): Promise<boolean> {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch (error) {
        console.error('Database connection error:', error);
        return false;
    }
}

// Close all connections (for graceful shutdown)
export async function closePool(): Promise<void> {
    await pool.end();
}

export default pool;

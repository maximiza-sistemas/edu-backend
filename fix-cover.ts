import pg from 'pg';

const pool = new pg.Pool({
    connectionString: 'postgres://livros:T1fpOr8Kw7KQEpU781gm9NWy7@144.126.137.156:5435/bd-livros?sslmode=disable'
});

async function updateCover() {
    try {
        // Clear invalid cover URLs
        const result = await pool.query(
            "UPDATE books SET cover_url = NULL WHERE cover_url LIKE '/uploads/images/%'"
        );
        console.log('Updated', result.rowCount, 'rows');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

updateCover();

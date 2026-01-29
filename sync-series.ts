import pg from 'pg';

const pool = new pg.Pool({
    connectionString: 'postgres://livros:T1fpOr8Kw7KQEpU781gm9NWy7@144.126.137.156:5435/bd-livros?sslmode=disable'
});

async function syncSeries() {
    try {
        // First, delete all existing series
        await pool.query('DELETE FROM series');
        console.log('Deleted existing series');

        // Insert new series matching class groups
        const newSeries = ['1º ANO', '2º ANO', '3º ANO', '4º ANO', '5º ANO'];

        for (const name of newSeries) {
            await pool.query('INSERT INTO series (id, name) VALUES (gen_random_uuid(), $1)', [name]);
            console.log(`Inserted: ${name}`);
        }

        // Verify
        const result = await pool.query('SELECT * FROM series ORDER BY name');
        console.log('\nSeries in database:');
        result.rows.forEach(row => console.log(`- ${row.name}`));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

syncSeries();

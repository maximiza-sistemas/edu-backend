import { query } from '../config/database.js';

async function migrate() {
    console.log('🚀 Running curriculum components migration...');

    try {
        // Create curriculum_components table
        await query(`
            CREATE TABLE IF NOT EXISTS curriculum_components (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table curriculum_components created');

        // Insert default components
        const components = [
            'Matemática',
            'Língua Portuguesa',
            'Ciências',
            'História',
            'Geografia',
            'Inglês',
            'Artes',
            'Educação Física',
            'Filosofia',
                        'Sociologia',
            'Pensamento Computacional'
        ];

        for (const name of components) {
            await query(
                `INSERT INTO curriculum_components (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
                [name]
            );
        }
        console.log('✅ Default curriculum components inserted');

        console.log('✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();

import { query, checkConnection, closePool } from '../config/database.js';
import { ensureTables, isDatabaseEmpty } from './migrate.js';
import bcrypt from 'bcryptjs';

/**
 * Database setup script - SAFE version.
 * 
 * - Always ensures tables exist (non-destructive)
 * - Only seeds demo data if the database is EMPTY (first-time setup)
 * - Safe to run multiple times without data loss
 */
async function setupDatabase() {
    console.log('🚀 Starting database setup...');

    // Check connection
    const connected = await checkConnection();
    if (!connected) {
        console.error('❌ Failed to connect to database');
        process.exit(1);
    }
    console.log('✅ Database connected');

    // Ensure tables exist (non-destructive - uses CREATE TABLE IF NOT EXISTS)
    await ensureTables();

    // Only seed demo data if database is empty (first-time setup)
    const empty = await isDatabaseEmpty();
    if (empty) {
        console.log('📦 Database is empty - seeding demo data...');
        await seedDemoData();
    } else {
        console.log('✅ Database already has data - skipping seed (data preserved)');
    }

    console.log('🎉 Database setup complete!');
    await closePool();
}

async function seedDemoData() {
    console.log('🌱 Seeding demo data...');

    // Hash password for demo users
    const passwordHash = await bcrypt.hash('senha123', 10);

    // Insert demo users
    const users = [
        {
            name: 'Administrador',
            email: 'admin@maxieducacao.com',
            role: 'admin',
            avatar: 'https://ui-avatars.com/api/?name=Admin&background=9b2c2c&color=fff'
        },
        {
            name: 'Prof. Maria Silva',
            email: 'maria.silva@maxieducacao.com',
            role: 'professor',
            avatar: 'https://ui-avatars.com/api/?name=Maria+Silva&background=1a365d&color=fff'
        },
        {
            name: 'Prof. João Santos',
            email: 'joao.santos@maxieducacao.com',
            role: 'professor',
            avatar: 'https://ui-avatars.com/api/?name=Joao+Santos&background=1a365d&color=fff'
        }
    ];

    const userIds: Record<string, string> = {};

    for (const user of users) {
        const result = await query(
            `INSERT INTO users (name, email, password_hash, role, avatar)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [user.name, user.email, passwordHash, user.role, user.avatar]
        );
        userIds[user.email] = result.rows[0].id;
        console.log(`  ✅ Created user: ${user.name}`);
    }

    // Insert students linked to professors
    const students = [
        { name: 'Ana Oliveira', email: 'ana.oliveira@aluno.maxieducacao.com', professorEmail: 'maria.silva@maxieducacao.com', classGroup: '1º Ano A' },
        { name: 'Pedro Costa', email: 'pedro.costa@aluno.maxieducacao.com', professorEmail: 'maria.silva@maxieducacao.com', classGroup: '1º Ano A' },
        { name: 'Lucas Fernandes', email: 'lucas.fernandes@aluno.maxieducacao.com', professorEmail: 'joao.santos@maxieducacao.com', classGroup: '2º Ano B' },
        { name: 'Julia Martins', email: 'julia.martins@aluno.maxieducacao.com', professorEmail: 'maria.silva@maxieducacao.com', classGroup: '1º Ano B' },
        { name: 'Gabriel Souza', email: 'gabriel.souza@aluno.maxieducacao.com', professorEmail: 'joao.santos@maxieducacao.com', classGroup: '3º Ano A' }
    ];

    for (const student of students) {
        const result = await query(
            `INSERT INTO users (name, email, password_hash, role, professor_id, class_group, avatar)
             VALUES ($1, $2, $3, 'student', $4, $5, $6)
             RETURNING id`,
            [
                student.name,
                student.email,
                passwordHash,
                userIds[student.professorEmail],
                student.classGroup,
                `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=276749&color=fff`
            ]
        );
        userIds[student.email] = result.rows[0].id;
        console.log(`  ✅ Created student: ${student.name}`);
    }

    // Insert demo books
    const books = [
        {
            title: 'Matemática Fundamental',
            author: 'Prof. Carlos Mendes',
            description: 'Livro completo de matemática para ensino fundamental com exercícios práticos e teoria detalhada.',
            coverUrl: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&h=600&fit=crop',
            curriculumComponent: 'Matemática',
            classGroups: ['1º Ano A', '1º Ano B', '2º Ano A']
        },
        {
            title: 'Português e Literatura',
            author: 'Profa. Regina Souza',
            description: 'Gramática, interpretação de texto e literatura brasileira em um único volume.',
            coverUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=600&fit=crop',
            curriculumComponent: 'Língua Portuguesa',
            classGroups: ['1º Ano A', '1º Ano B', '2º Ano A', '2º Ano B']
        },
        {
            title: 'Ciências da Natureza',
            author: 'Dr. Roberto Lima',
            description: 'Física, química e biologia integradas para uma compreensão completa do mundo natural.',
            coverUrl: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=400&h=600&fit=crop',
            curriculumComponent: 'Ciências',
            classGroups: ['2º Ano A', '2º Ano B', '3º Ano A']
        },
        {
            title: 'História do Brasil',
            author: 'Profa. Amanda Rocha',
            description: 'Da colonização aos dias atuais, uma jornada pela história brasileira.',
            coverUrl: 'https://images.unsplash.com/photo-1461360370896-922624d12a74?w=400&h=600&fit=crop',
            curriculumComponent: 'História',
            classGroups: ['3º Ano A', '3º Ano B', '4º Ano A']
        },
        {
            title: 'Geografia Mundial',
            author: 'Prof. Fernando Alves',
            description: 'Geopolítica, clima, relevo e sociedade em perspectiva global.',
            coverUrl: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=400&h=600&fit=crop',
            curriculumComponent: 'Geografia',
            classGroups: ['4º Ano A', '4º Ano B', '5º Ano A']
        },
        {
            title: 'Inglês Intermediário',
            author: 'Prof. Michael Brown',
            description: 'Desenvolva suas habilidades de leitura, escrita e conversação em inglês.',
            coverUrl: 'https://images.unsplash.com/photo-1543109740-4bdb38fda756?w=400&h=600&fit=crop',
            curriculumComponent: 'Inglês',
            classGroups: ['1º Ano A', '2º Ano A', '3º Ano A']
        },
        {
            title: 'Artes Visuais',
            author: 'Profa. Lucia Campos',
            description: 'Explore técnicas de desenho, pintura e história da arte.',
            coverUrl: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=600&fit=crop',
            curriculumComponent: 'Artes',
            classGroups: ['1º Ano A', '1º Ano B', '2º Ano A', '2º Ano B']
        },
        {
            title: 'Educação Física Escolar',
            author: 'Prof. Ricardo Lima',
            description: 'Práticas esportivas, saúde e bem-estar para estudantes.',
            coverUrl: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&h=600&fit=crop',
            curriculumComponent: 'Educação Física',
            classGroups: ['1º Ano A', '1º Ano B', '2º Ano A', '3º Ano A']
        }
    ];

    const bookIds: Record<string, string> = {};

    for (const book of books) {
        const result = await query(
            `INSERT INTO books (title, author, description, cover_url, curriculum_component)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [book.title, book.author, book.description, book.coverUrl, book.curriculumComponent]
        );
        bookIds[book.title] = result.rows[0].id;

        // Insert class groups for this book
        for (const classGroup of book.classGroups) {
            await query(
                `INSERT INTO book_class_groups (book_id, class_group) VALUES ($1, $2)`,
                [result.rows[0].id, classGroup]
            );
        }
        console.log(`  ✅ Created book: ${book.title}`);
    }

    // Insert demo book assignments
    const assignments = [
        { bookTitle: 'Matemática Fundamental', userEmail: 'maria.silva@maxieducacao.com', progress: 45 },
        { bookTitle: 'Português e Literatura', userEmail: 'maria.silva@maxieducacao.com', progress: 80 },
        { bookTitle: 'Ciências da Natureza', userEmail: 'joao.santos@maxieducacao.com', progress: 30 },
        { bookTitle: 'História do Brasil', userEmail: 'joao.santos@maxieducacao.com', progress: 60 },
        { bookTitle: 'Matemática Fundamental', userEmail: 'ana.oliveira@aluno.maxieducacao.com', progress: 20 },
        { bookTitle: 'Português e Literatura', userEmail: 'ana.oliveira@aluno.maxieducacao.com', progress: 55 },
        { bookTitle: 'Matemática Fundamental', userEmail: 'pedro.costa@aluno.maxieducacao.com', progress: 35 },
        { bookTitle: 'Ciências da Natureza', userEmail: 'lucas.fernandes@aluno.maxieducacao.com', progress: 10 },
        { bookTitle: 'Geografia Mundial', userEmail: 'maria.silva@maxieducacao.com', progress: 15 },
        { bookTitle: 'Inglês Intermediário', userEmail: 'pedro.costa@aluno.maxieducacao.com', progress: 5 },
        { bookTitle: 'Artes Visuais', userEmail: 'julia.martins@aluno.maxieducacao.com', progress: 25 },
        { bookTitle: 'Educação Física Escolar', userEmail: 'gabriel.souza@aluno.maxieducacao.com', progress: 40 }
    ];

    for (const assignment of assignments) {
        await query(
            `INSERT INTO book_assignments (book_id, user_id, progress)
             VALUES ($1, $2, $3)`,
            [bookIds[assignment.bookTitle], userIds[assignment.userEmail], assignment.progress]
        );
    }
    console.log(`  ✅ Created ${assignments.length} book assignments`);
}

// Run setup
setupDatabase().catch((err) => {
    console.error('❌ Setup failed:', err);
    process.exit(1);
});

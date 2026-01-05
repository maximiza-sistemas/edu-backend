import { Request, Response } from 'express';
import { query, withTransaction } from '../config/database.js';
import { Book, CreateBookRequest, UpdateBookRequest, BookFilters, ClassGroup } from '../types/index.js';

// Extended book type with class_groups array
interface BookWithGroups extends Omit<Book, 'class_groups'> {
    class_groups: ClassGroup[];
}

// Get all books with filters and pagination
export async function getBooks(req: Request, res: Response): Promise<void> {
    const filters: BookFilters = {
        search: req.query.search as string,
        curriculum_component: req.query.curriculum_component as BookFilters['curriculum_component'],
        class_group: req.query.class_group as BookFilters['class_group'],
        professor_id: req.query.professor_id as string,
        student_id: req.query.student_id as string,
        limit: Math.min(parseInt(req.query.limit as string) || 50, 100),
        offset: parseInt(req.query.offset as string) || 0
    };

    let whereClause = '';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.search) {
        whereClause += ` WHERE (b.title ILIKE $${paramIndex} OR b.author ILIKE $${paramIndex} OR b.description ILIKE $${paramIndex})`;
        params.push(`%${filters.search}%`);
        paramIndex++;
    }

    if (filters.curriculum_component && filters.curriculum_component !== 'all') {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` b.curriculum_component = $${paramIndex++}`;
        params.push(filters.curriculum_component);
    }

    if (filters.class_group && filters.class_group !== 'all') {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` EXISTS (SELECT 1 FROM book_class_groups bcg WHERE bcg.book_id = b.id AND bcg.class_group = $${paramIndex++})`;
        params.push(filters.class_group);
    }

    if (filters.professor_id && filters.professor_id !== 'all') {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` EXISTS (SELECT 1 FROM book_assignments ba WHERE ba.book_id = b.id AND ba.user_id = $${paramIndex++})`;
        params.push(filters.professor_id);
    }

    if (filters.student_id && filters.student_id !== 'all') {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` EXISTS (SELECT 1 FROM book_assignments ba WHERE ba.book_id = b.id AND ba.user_id = $${paramIndex++})`;
        params.push(filters.student_id);
    }

    // Get total count
    const countResult = await query(`SELECT COUNT(*) FROM books b${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    // Get books with class groups
    params.push(filters.limit, filters.offset);
    const result = await query<Book>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, 
                b.curriculum_component, b.book_type, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b${whereClause}
         ORDER BY b.title ASC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        params
    );

    res.json({
        data: result.rows,
        total,
        limit: filters.limit,
        offset: filters.offset
    });
}

// Get book by ID
export async function getBookById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query<BookWithGroups>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url,
                b.curriculum_component, b.book_type, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b WHERE b.id = $1`,
        [id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Livro não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Create new book
export async function createBook(req: Request, res: Response): Promise<void> {
    const data = req.body as CreateBookRequest;

    if (!data.title || !data.author || !data.curriculum_component) {
        res.status(400).json({ error: 'Título, autor e componente curricular são obrigatórios' });
        return;
    }

    const book = await withTransaction(async (client) => {
        // Insert book
        const bookResult = await client.query<Book>(
            `INSERT INTO books (title, author, description, cover_url, pdf_url, curriculum_component, book_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [data.title, data.author, data.description || '', data.cover_url || '', data.pdf_url || null, data.curriculum_component, data.book_type || 'student']
        );

        const newBook = bookResult.rows[0];

        // Insert class groups
        if (data.class_groups && data.class_groups.length > 0) {
            const values = data.class_groups.map((_, i) => `($1, $${i + 2})`).join(', ');
            await client.query(
                `INSERT INTO book_class_groups (book_id, class_group) VALUES ${values}`,
                [newBook.id, ...data.class_groups]
            );
        }

        return { ...newBook, class_groups: data.class_groups || [] };
    });

    res.status(201).json(book);
}

// Update book
export async function updateBook(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const data = req.body as UpdateBookRequest;

    const book = await withTransaction(async (client) => {
        // Build dynamic update query
        const updates: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (data.title !== undefined) {
            updates.push(`title = $${paramIndex++}`);
            params.push(data.title);
        }

        if (data.author !== undefined) {
            updates.push(`author = $${paramIndex++}`);
            params.push(data.author);
        }

        if (data.description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            params.push(data.description);
        }

        if (data.cover_url !== undefined) {
            updates.push(`cover_url = $${paramIndex++}`);
            params.push(data.cover_url);
        }

        if (data.pdf_url !== undefined) {
            updates.push(`pdf_url = $${paramIndex++}`);
            params.push(data.pdf_url);
        }

        if (data.curriculum_component !== undefined) {
            updates.push(`curriculum_component = $${paramIndex++}`);
            params.push(data.curriculum_component);
        }

        if (data.book_type !== undefined) {
            updates.push(`book_type = $${paramIndex++}`);
            params.push(data.book_type);
        }

        let updatedBook: Book;

        if (updates.length > 0) {
            params.push(id);
            const result = await client.query<Book>(
                `UPDATE books SET ${updates.join(', ')}
                 WHERE id = $${paramIndex}
                 RETURNING *`,
                params
            );

            if (result.rows.length === 0) {
                throw { statusCode: 404, message: 'Livro não encontrado' };
            }

            updatedBook = result.rows[0];
        } else {
            const result = await client.query<Book>('SELECT * FROM books WHERE id = $1', [id]);
            if (result.rows.length === 0) {
                throw { statusCode: 404, message: 'Livro não encontrado' };
            }
            updatedBook = result.rows[0];
        }

        // Update class groups if provided
        if (data.class_groups !== undefined) {
            await client.query('DELETE FROM book_class_groups WHERE book_id = $1', [id]);

            if (data.class_groups.length > 0) {
                const values = data.class_groups.map((_, i) => `($1, $${i + 2})`).join(', ');
                await client.query(
                    `INSERT INTO book_class_groups (book_id, class_group) VALUES ${values}`,
                    [id, ...data.class_groups]
                );
            }
        }

        // Get final class groups
        const groupsResult = await client.query<{ class_group: string }>(
            'SELECT class_group FROM book_class_groups WHERE book_id = $1 ORDER BY class_group',
            [id]
        );

        return {
            ...updatedBook,
            class_groups: groupsResult.rows.map(r => r.class_group as ClassGroup)
        };
    });

    res.json(book);
}

// Delete book
export async function deleteBook(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query('DELETE FROM books WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Livro não encontrado' });
        return;
    }

    res.json({ message: 'Livro deletado com sucesso' });
}

// Get books by curriculum component
export async function getBooksByComponent(req: Request, res: Response): Promise<void> {
    const { component } = req.params;

    const result = await query<BookWithGroups>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url,
                b.curriculum_component, b.book_type, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b WHERE b.curriculum_component = $1
         ORDER BY b.title ASC`,
        [component]
    );

    res.json(result.rows);
}

// Get books by class group
export async function getBooksByClass(req: Request, res: Response): Promise<void> {
    const { classGroup } = req.params;

    const result = await query<BookWithGroups>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url,
                b.curriculum_component, b.book_type, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b
         WHERE EXISTS (SELECT 1 FROM book_class_groups bcg WHERE bcg.book_id = b.id AND bcg.class_group = $1)
         ORDER BY b.title ASC`,
        [classGroup]
    );

    res.json(result.rows);
}

// Get books for a student based on their class_group
export async function getBooksByStudent(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;

    // First get the student's class_group
    const userResult = await query<{ class_group: string }>(
        'SELECT class_group FROM users WHERE id = $1',
        [userId]
    );

    if (userResult.rows.length === 0) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }

    const classGroup = userResult.rows[0].class_group;

    if (!classGroup) {
        // Student has no class assigned, return empty array
        res.json([]);
        return;
    }

    // Get books for that class - ONLY STUDENT BOOKS
    const result = await query<BookWithGroups>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url,
                b.curriculum_component, b.book_type, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b
         WHERE b.book_type = 'student'
           AND EXISTS (SELECT 1 FROM book_class_groups bcg WHERE bcg.book_id = b.id AND bcg.class_group = $1)
         ORDER BY b.title ASC`,
        [classGroup]
    );

    res.json(result.rows);
}

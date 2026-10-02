import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import { query, withTransaction } from '../config/database.js';
import { Book, CreateBookRequest, UpdateBookRequest, BookFilters, ClassGroup } from '../types/index.js';
import { normalizeBookMedia } from '../utils/mediaValidation.js';
import { removeUnreferencedMedia } from './uploadController.js';

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
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, b.content_type, b.media_url,
                b.curriculum_component, b.book_type, b.level, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b${whereClause}
         ORDER BY b.title ASC, b.id ASC
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
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, b.content_type, b.media_url,
                b.curriculum_component, b.book_type, b.level, b.created_at, b.updated_at,
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

    const hasLevel = !!(data.level && data.level.trim());
    const hasGroups = !!(data.class_groups && data.class_groups.length > 0);

    if (hasLevel === hasGroups) {
        res.status(400).json({ error: 'Selecione um nível OU uma ou mais turmas (exatamente um dos dois).' });
        return;
    }

    const media = normalizeBookMedia(data.content_type ?? 'pdf', data.media_url, data.pdf_url);
    if (!media.ok) {
        res.status(400).json({ error: media.error });
        return;
    }

    const level = hasLevel ? data.level!.trim() : null;
    const classGroups = hasLevel ? [] : data.class_groups;

    const book = await withTransaction(async (client) => {
        const bookResult = await client.query<Book>(
            `INSERT INTO books (title, author, description, cover_url, pdf_url, content_type, media_url, curriculum_component, book_type, level)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [data.title, data.author, data.description || '', data.cover_url || '', media.pdf_url, media.content_type, media.media_url, data.curriculum_component, data.book_type || 'student', level]
        );

        const newBook = bookResult.rows[0];

        if (classGroups.length > 0) {
            const values = classGroups.map((_, i) => `($1, $${i + 2})`).join(', ');
            await client.query(
                `INSERT INTO book_class_groups (book_id, class_group) VALUES ${values}`,
                [newBook.id, ...classGroups]
            );
        }

        return { ...newBook, class_groups: classGroups };
    });

    res.status(201).json(book);
}

type BookMedia = Pick<Book, 'content_type' | 'media_url'> & { pdf_url: string | null };

interface MediaUpdate {
    media: BookMedia;
    previousMediaUrl: string | null;
}

// Fields that were not sent keep their stored value; the source of the other formats is cleared.
// A stored media_url never fits another format, so it is dropped when only content_type changes.
async function resolveMediaUpdate(client: PoolClient, id: string, data: UpdateBookRequest): Promise<MediaUpdate> {
    const current = await client.query<BookMedia>(
        'SELECT content_type, media_url, pdf_url FROM books WHERE id = $1 FOR UPDATE',
        [id]
    );
    if (current.rows.length === 0) {
        throw { statusCode: 404, message: 'Livro não encontrado' };
    }

    const stored = current.rows[0];
    const contentType = data.content_type ?? stored.content_type;
    const keptMediaUrl = contentType === stored.content_type ? stored.media_url : null;
    const media = normalizeBookMedia(
        contentType,
        data.media_url !== undefined ? data.media_url : keptMediaUrl,
        data.pdf_url !== undefined ? data.pdf_url : stored.pdf_url
    );
    if (!media.ok) {
        throw { statusCode: 400, message: media.error };
    }

    return {
        media: { content_type: media.content_type, media_url: media.media_url, pdf_url: media.pdf_url },
        previousMediaUrl: stored.media_url
    };
}

// Update book
export async function updateBook(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const data = req.body as UpdateBookRequest;

    const levelProvided = data.level !== undefined;
    const groupsProvided = data.class_groups !== undefined;
    if (levelProvided && groupsProvided) {
        const hasLevel = !!(data.level && data.level.trim());
        const hasGroups = !!(data.class_groups && data.class_groups.length > 0);
        if (hasLevel === hasGroups) {
            res.status(400).json({ error: 'Selecione um nível OU uma ou mais turmas (exatamente um dos dois).' });
            return;
        }
    }

    const mediaProvided = data.content_type !== undefined || data.media_url !== undefined || data.pdf_url !== undefined;
    let previousMediaUrl: string | null = null;

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

        if (mediaProvided) {
            const { media, previousMediaUrl: storedMediaUrl } = await resolveMediaUpdate(client, id, data);
            previousMediaUrl = storedMediaUrl;
            updates.push(`content_type = $${paramIndex++}`);
            params.push(media.content_type);
            updates.push(`media_url = $${paramIndex++}`);
            params.push(media.media_url);
            updates.push(`pdf_url = $${paramIndex++}`);
            params.push(media.pdf_url);
        }

        if (data.curriculum_component !== undefined) {
            updates.push(`curriculum_component = $${paramIndex++}`);
            params.push(data.curriculum_component);
        }

        if (data.book_type !== undefined) {
            updates.push(`book_type = $${paramIndex++}`);
            params.push(data.book_type);
        }

        if (data.level !== undefined) {
            const lvl = data.level && data.level.trim() ? data.level.trim() : null;
            updates.push(`level = $${paramIndex++}`);
            params.push(lvl);
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

        // Exclusividade: se veio um nível não-nulo, zera as turmas
        const clearingGroupsForLevel = data.level !== undefined && !!(data.level && data.level.trim());

        // Update class groups if provided (ou limpar se virou livro de nível)
        if (data.class_groups !== undefined || clearingGroupsForLevel) {
            const groups = clearingGroupsForLevel ? [] : (data.class_groups || []);
            await client.query('DELETE FROM book_class_groups WHERE book_id = $1', [id]);

            if (groups.length > 0) {
                const values = groups.map((_, i) => `($1, $${i + 2})`).join(', ');
                await client.query(
                    `INSERT INTO book_class_groups (book_id, class_group) VALUES ${values}`,
                    [id, ...groups]
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

    // Only after the commit: the replaced or cleared file is deleted if no other material uses it
    if (previousMediaUrl && previousMediaUrl !== book.media_url) {
        await removeUnreferencedMedia([previousMediaUrl]);
    }

    res.json(book);
}

// Delete book
export async function deleteBook(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query<Pick<Book, 'id' | 'media_url'>>('DELETE FROM books WHERE id = $1 RETURNING id, media_url', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Livro não encontrado' });
        return;
    }

    // The DELETE has committed (single statement); the file goes too unless another material uses it
    await removeUnreferencedMedia([result.rows[0].media_url]);

    res.json({ message: 'Livro deletado com sucesso' });
}

// Get books by curriculum component
export async function getBooksByComponent(req: Request, res: Response): Promise<void> {
    const { component } = req.params;

    const result = await query<BookWithGroups>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, b.content_type, b.media_url,
                b.curriculum_component, b.book_type, b.level, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b WHERE b.curriculum_component = $1
         ORDER BY b.title ASC, b.id ASC`,
        [component]
    );

    res.json(result.rows);
}

// Get books by class group
export async function getBooksByClass(req: Request, res: Response): Promise<void> {
    const { classGroup } = req.params;

    const result = await query<BookWithGroups>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, b.content_type, b.media_url,
                b.curriculum_component, b.book_type, b.level, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b
         WHERE EXISTS (SELECT 1 FROM book_class_groups bcg WHERE bcg.book_id = b.id AND bcg.class_group = $1)
         ORDER BY b.title ASC, b.id ASC`,
        [classGroup]
    );

    res.json(result.rows);
}

// Get all books that belong to the "levels world" (level IS NOT NULL)
export async function getLevelBooks(_req: Request, res: Response): Promise<void> {
    const result = await query<Book>(
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, b.content_type, b.media_url,
                b.curriculum_component, b.book_type, b.level, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b
         WHERE b.level IS NOT NULL
         ORDER BY b.level ASC, b.title ASC, b.id ASC`
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
        `SELECT b.id, b.title, b.author, b.description, b.cover_url, b.pdf_url, b.content_type, b.media_url,
                b.curriculum_component, b.book_type, b.level, b.created_at, b.updated_at,
                COALESCE(
                    (SELECT array_agg(bcg.class_group ORDER BY bcg.class_group)
                     FROM book_class_groups bcg WHERE bcg.book_id = b.id),
                    ARRAY[]::varchar[]
                ) as class_groups
         FROM books b
         WHERE b.book_type = 'student'
           AND EXISTS (SELECT 1 FROM book_class_groups bcg WHERE bcg.book_id = b.id AND bcg.class_group = $1)
         ORDER BY b.title ASC, b.id ASC`,
        [classGroup]
    );

    res.json(result.rows);
}

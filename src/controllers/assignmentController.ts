import { Request, Response } from 'express';
import { query } from '../config/database.js';
import { BookAssignment, CreateAssignmentRequest, UpdateAssignmentRequest } from '../types/index.js';

// Extended assignment with book and user details
interface AssignmentWithDetails extends BookAssignment {
    book_title?: string;
    user_name?: string;
    user_email?: string;
}

// Get all assignments with pagination
export async function getAssignments(req: Request, res: Response): Promise<void> {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const bookId = req.query.book_id as string;
    const userId = req.query.user_id as string;

    let whereClause = '';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (bookId) {
        whereClause += ` WHERE ba.book_id = $${paramIndex++}`;
        params.push(bookId);
    }

    if (userId) {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` ba.user_id = $${paramIndex++}`;
        params.push(userId);
    }

    const countResult = await query(`SELECT COUNT(*) FROM book_assignments ba${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await query<AssignmentWithDetails>(
        `SELECT ba.id, ba.book_id, ba.user_id, ba.assigned_at, ba.progress,
                b.title as book_title, u.name as user_name, u.email as user_email
         FROM book_assignments ba
         JOIN books b ON ba.book_id = b.id
         JOIN users u ON ba.user_id = u.id
         ${whereClause}
         ORDER BY ba.assigned_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        params
    );

    res.json({
        data: result.rows,
        total,
        limit,
        offset
    });
}

// Get assignment by ID
export async function getAssignmentById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query<AssignmentWithDetails>(
        `SELECT ba.id, ba.book_id, ba.user_id, ba.assigned_at, ba.progress,
                b.title as book_title, u.name as user_name, u.email as user_email
         FROM book_assignments ba
         JOIN books b ON ba.book_id = b.id
         JOIN users u ON ba.user_id = u.id
         WHERE ba.id = $1`,
        [id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Atribuição não encontrada' });
        return;
    }

    res.json(result.rows[0]);
}

// Create assignment (assign book to user)
export async function createAssignment(req: Request, res: Response): Promise<void> {
    const data = req.body as CreateAssignmentRequest;

    if (!data.book_id || !data.user_id) {
        res.status(400).json({ error: 'ID do livro e ID do usuário são obrigatórios' });
        return;
    }

    // Check if book exists
    const bookCheck = await query('SELECT id FROM books WHERE id = $1', [data.book_id]);
    if (bookCheck.rows.length === 0) {
        res.status(404).json({ error: 'Livro não encontrado' });
        return;
    }

    // Check if user exists
    const userCheck = await query('SELECT id FROM users WHERE id = $1', [data.user_id]);
    if (userCheck.rows.length === 0) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }

    const result = await query<BookAssignment>(
        `INSERT INTO book_assignments (book_id, user_id, progress)
         VALUES ($1, $2, 0)
         ON CONFLICT (book_id, user_id) DO NOTHING
         RETURNING *`,
        [data.book_id, data.user_id]
    );

    if (result.rows.length === 0) {
        res.status(409).json({ error: 'Este livro já está atribuído a este usuário' });
        return;
    }

    res.status(201).json(result.rows[0]);
}

// Update assignment (update progress)
export async function updateAssignment(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const data = req.body as UpdateAssignmentRequest;

    if (data.progress === undefined || data.progress < 0 || data.progress > 100) {
        res.status(400).json({ error: 'Progresso deve ser um número entre 0 e 100' });
        return;
    }

    const result = await query<BookAssignment>(
        `UPDATE book_assignments SET progress = $1 WHERE id = $2 RETURNING *`,
        [data.progress, id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Atribuição não encontrada' });
        return;
    }

    res.json(result.rows[0]);
}

// Delete assignment (unassign book from user)
export async function deleteAssignment(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query('DELETE FROM book_assignments WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Atribuição não encontrada' });
        return;
    }

    res.json({ message: 'Atribuição removida com sucesso' });
}

// Delete assignment by book and user
export async function deleteAssignmentByBookAndUser(req: Request, res: Response): Promise<void> {
    const { bookId, userId } = req.params;

    const result = await query(
        'DELETE FROM book_assignments WHERE book_id = $1 AND user_id = $2 RETURNING id',
        [bookId, userId]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Atribuição não encontrada' });
        return;
    }

    res.json({ message: 'Atribuição removida com sucesso' });
}

// Get assignments by user
export async function getAssignmentsByUser(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;

    const result = await query<AssignmentWithDetails>(
        `SELECT ba.id, ba.book_id, ba.user_id, ba.assigned_at, ba.progress,
                b.title as book_title, b.author, b.cover_url, b.curriculum_component
         FROM book_assignments ba
         JOIN books b ON ba.book_id = b.id
         WHERE ba.user_id = $1
         ORDER BY ba.assigned_at DESC`,
        [userId]
    );

    res.json(result.rows);
}

// Get assignments by book
export async function getAssignmentsByBook(req: Request, res: Response): Promise<void> {
    const { bookId } = req.params;

    const result = await query<AssignmentWithDetails>(
        `SELECT ba.id, ba.book_id, ba.user_id, ba.assigned_at, ba.progress,
                u.name as user_name, u.email as user_email, u.role as user_role
         FROM book_assignments ba
         JOIN users u ON ba.user_id = u.id
         WHERE ba.book_id = $1
         ORDER BY u.name ASC`,
        [bookId]
    );

    res.json(result.rows);
}

// Update progress by book and user
export async function updateProgressByBookAndUser(req: Request, res: Response): Promise<void> {
    const { bookId, userId } = req.params;
    const { progress } = req.body as { progress: number };

    if (progress === undefined || progress < 0 || progress > 100) {
        res.status(400).json({ error: 'Progresso deve ser um número entre 0 e 100' });
        return;
    }

    const result = await query<BookAssignment>(
        `UPDATE book_assignments SET progress = $1 
         WHERE book_id = $2 AND user_id = $3 
         RETURNING *`,
        [progress, bookId, userId]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Atribuição não encontrada' });
        return;
    }

    res.json(result.rows[0]);
}

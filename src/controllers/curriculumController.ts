import { Request, Response } from 'express';
import { query } from '../config/database.js';

// Get all curriculum components
export async function getCurriculumComponents(_req: Request, res: Response): Promise<void> {
    const result = await query(`
        SELECT id, name, created_at
        FROM curriculum_components
        ORDER BY name ASC
    `);
    res.json(result.rows);
}

// Get a single curriculum component by ID
export async function getCurriculumComponentById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const result = await query(
        'SELECT id, name, created_at FROM curriculum_components WHERE id = $1',
        [id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Componente curricular não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Create a new curriculum component
export async function createCurriculumComponent(req: Request, res: Response): Promise<void> {
    const { name } = req.body;

    if (!name || name.trim() === '') {
        res.status(400).json({ error: 'Nome é obrigatório' });
        return;
    }

    // Check if already exists
    const existing = await query(
        'SELECT id FROM curriculum_components WHERE LOWER(name) = LOWER($1)',
        [name.trim()]
    );

    if (existing.rows.length > 0) {
        res.status(409).json({ error: 'Componente curricular já existe' });
        return;
    }

    const result = await query(
        `INSERT INTO curriculum_components (name)
         VALUES ($1)
         RETURNING id, name, created_at`,
        [name.trim()]
    );

    res.status(201).json(result.rows[0]);
}

// Update a curriculum component
export async function updateCurriculumComponent(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
        res.status(400).json({ error: 'Nome é obrigatório' });
        return;
    }

    // Check if new name already exists (and it's not this component)
    const existing = await query(
        'SELECT id FROM curriculum_components WHERE LOWER(name) = LOWER($1) AND id != $2',
        [name.trim(), id]
    );

    if (existing.rows.length > 0) {
        res.status(409).json({ error: 'Componente curricular já existe com esse nome' });
        return;
    }

    const result = await query(
        `UPDATE curriculum_components
         SET name = $1
         WHERE id = $2
         RETURNING id, name, created_at`,
        [name.trim(), id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Componente curricular não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Delete a curriculum component
export async function deleteCurriculumComponent(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    // Check if any books use this component
    const booksUsing = await query(
        `SELECT COUNT(*) as count FROM books b
         JOIN curriculum_components c ON b.curriculum_component = c.name
         WHERE c.id = $1`,
        [id]
    );

    if (parseInt(booksUsing.rows[0].count) > 0) {
        res.status(409).json({
            error: 'Não é possível excluir. Existem livros usando este componente curricular.'
        });
        return;
    }

    const result = await query(
        'DELETE FROM curriculum_components WHERE id = $1 RETURNING id',
        [id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Componente curricular não encontrado' });
        return;
    }

    res.json({ message: 'Componente curricular excluído com sucesso' });
}

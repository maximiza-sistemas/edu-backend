import { Request, Response } from 'express';
import { query } from '../config/database.js';

export interface Series {
    id: string;
    name: string;
    created_at: string;
}

// Get all series
export async function getAllSeries(req: Request, res: Response): Promise<void> {
    const result = await query<Series>(
        'SELECT * FROM series ORDER BY name ASC'
    );
    res.json(result.rows);
}

// Get series by ID
export async function getSeriesById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const result = await query<Series>('SELECT * FROM series WHERE id = $1', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Série não encontrada' });
        return;
    }

    res.json(result.rows[0]);
}

// Create new series
export async function createSeries(req: Request, res: Response): Promise<void> {
    const { name } = req.body;

    if (!name || !name.trim()) {
        res.status(400).json({ error: 'Nome da série é obrigatório' });
        return;
    }

    // Check for duplicate
    const existing = await query('SELECT id FROM series WHERE LOWER(name) = LOWER($1)', [name.trim()]);
    if (existing.rows.length > 0) {
        res.status(400).json({ error: 'Já existe uma série com esse nome' });
        return;
    }

    const result = await query<Series>(
        'INSERT INTO series (name) VALUES ($1) RETURNING *',
        [name.trim()]
    );

    res.status(201).json(result.rows[0]);
}

// Update series
export async function updateSeries(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
        res.status(400).json({ error: 'Nome da série é obrigatório' });
        return;
    }

    // Check for duplicate
    const existing = await query('SELECT id FROM series WHERE LOWER(name) = LOWER($1) AND id != $2', [name.trim(), id]);
    if (existing.rows.length > 0) {
        res.status(400).json({ error: 'Já existe uma série com esse nome' });
        return;
    }

    const result = await query<Series>(
        'UPDATE series SET name = $1 WHERE id = $2 RETURNING *',
        [name.trim(), id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Série não encontrada' });
        return;
    }

    res.json(result.rows[0]);
}

// Delete series
export async function deleteSeries(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query('DELETE FROM series WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Série não encontrada' });
        return;
    }

    res.json({ message: 'Série excluída com sucesso' });
}

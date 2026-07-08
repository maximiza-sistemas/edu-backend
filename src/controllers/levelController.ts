import { Request, Response } from 'express';
import { query } from '../config/database.js';

export interface Level {
    id: string;
    name: string;
    created_at: string;
}

// Get all levels
export async function getAllLevels(_req: Request, res: Response): Promise<void> {
    const result = await query<Level>('SELECT * FROM levels ORDER BY name ASC');
    res.json(result.rows);
}

// Get level by ID
export async function getLevelById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const result = await query<Level>('SELECT * FROM levels WHERE id = $1', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Nível não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Create new level
export async function createLevel(req: Request, res: Response): Promise<void> {
    const { name } = req.body;

    if (!name || !name.trim()) {
        res.status(400).json({ error: 'Nome do nível é obrigatório' });
        return;
    }

    const existing = await query('SELECT id FROM levels WHERE LOWER(name) = LOWER($1)', [name.trim()]);
    if (existing.rows.length > 0) {
        res.status(400).json({ error: 'Já existe um nível com esse nome' });
        return;
    }

    const result = await query<Level>(
        'INSERT INTO levels (name) VALUES ($1) RETURNING *',
        [name.trim()]
    );

    res.status(201).json(result.rows[0]);
}

// Update level
export async function updateLevel(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
        res.status(400).json({ error: 'Nome do nível é obrigatório' });
        return;
    }

    const existing = await query('SELECT id FROM levels WHERE LOWER(name) = LOWER($1) AND id != $2', [name.trim(), id]);
    if (existing.rows.length > 0) {
        res.status(400).json({ error: 'Já existe um nível com esse nome' });
        return;
    }

    const result = await query<Level>(
        'UPDATE levels SET name = $1 WHERE id = $2 RETURNING *',
        [name.trim(), id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Nível não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Delete level
export async function deleteLevel(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query('DELETE FROM levels WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Nível não encontrado' });
        return;
    }

    res.json({ message: 'Nível excluído com sucesso' });
}

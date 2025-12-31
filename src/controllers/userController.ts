import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import { User, CreateUserRequest, UpdateUserRequest, UserPublic } from '../types/index.js';

// Get all users with pagination
export async function getUsers(req: Request, res: Response): Promise<void> {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const role = req.query.role as string;
    const professorId = req.query.professor_id as string;
    const classGroup = req.query.class_group as string;

    let whereClause = '';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (role) {
        whereClause += ` WHERE role = $${paramIndex++}`;
        params.push(role);
    }

    if (professorId) {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` professor_id = $${paramIndex++}`;
        params.push(professorId);
    }

    if (classGroup) {
        whereClause += whereClause ? ' AND' : ' WHERE';
        whereClause += ` class_group = $${paramIndex++}`;
        params.push(classGroup);
    }

    const countResult = await query(`SELECT COUNT(*) FROM users${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await query<UserPublic>(
        `SELECT id, name, email, role, avatar, professor_id, class_group, created_at, updated_at
         FROM users${whereClause}
         ORDER BY name ASC
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

// Get user by ID
export async function getUserById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query<UserPublic>(
        `SELECT id, name, email, role, avatar, professor_id, class_group, created_at, updated_at
         FROM users WHERE id = $1`,
        [id]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Create new user
export async function createUser(req: Request, res: Response): Promise<void> {
    const data = req.body as CreateUserRequest;

    if (!data.name || !data.email || !data.password || !data.role) {
        res.status(400).json({ error: 'Nome, email, senha e função são obrigatórios' });
        return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Generate avatar URL
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=${data.role === 'admin' ? 'ef4444' : data.role === 'professor' ? '3b82f6' : '22c55e'
        }&color=fff`;

    const result = await query<User>(
        `INSERT INTO users (name, email, password_hash, role, professor_id, class_group, avatar)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, email, role, avatar, professor_id, class_group, created_at, updated_at`,
        [data.name, data.email, passwordHash, data.role, data.professor_id || null, data.class_group || null, avatar]
    );

    res.status(201).json(result.rows[0]);
}

// Update user
export async function updateUser(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const data = req.body as UpdateUserRequest;

    // Build dynamic update query
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        params.push(data.name);
    }

    if (data.email !== undefined) {
        updates.push(`email = $${paramIndex++}`);
        params.push(data.email);
    }

    if (data.password !== undefined) {
        const passwordHash = await bcrypt.hash(data.password, 10);
        updates.push(`password_hash = $${paramIndex++}`);
        params.push(passwordHash);
    }

    if (data.role !== undefined) {
        updates.push(`role = $${paramIndex++}`);
        params.push(data.role);
    }

    if (data.professor_id !== undefined) {
        updates.push(`professor_id = $${paramIndex++}`);
        params.push(data.professor_id || null);
    }

    if (data.class_group !== undefined) {
        updates.push(`class_group = $${paramIndex++}`);
        params.push(data.class_group || null);
    }

    if (updates.length === 0) {
        res.status(400).json({ error: 'Nenhum campo para atualizar' });
        return;
    }

    params.push(id);
    const result = await query<UserPublic>(
        `UPDATE users SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, name, email, role, avatar, professor_id, class_group, created_at, updated_at`,
        params
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

// Delete user
export async function deleteUser(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }

    res.json({ message: 'Usuário deletado com sucesso' });
}

// Get students by professor
export async function getStudentsByProfessor(req: Request, res: Response): Promise<void> {
    const { professorId } = req.params;

    const result = await query<UserPublic>(
        `SELECT id, name, email, role, avatar, professor_id, class_group, created_at, updated_at
         FROM users WHERE professor_id = $1 AND role = 'student'
         ORDER BY name ASC`,
        [professorId]
    );

    res.json(result.rows);
}

// Get users by role
export async function getUsersByRole(req: Request, res: Response): Promise<void> {
    const { role } = req.params;

    if (!['admin', 'professor', 'student'].includes(role)) {
        res.status(400).json({ error: 'Função inválida' });
        return;
    }

    const result = await query<UserPublic>(
        `SELECT id, name, email, role, avatar, professor_id, class_group, created_at, updated_at
         FROM users WHERE role = $1
         ORDER BY name ASC`,
        [role]
    );

    res.json(result.rows);
}

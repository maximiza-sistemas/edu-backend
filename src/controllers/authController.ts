import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { User, LoginRequest, LoginResponse } from '../types/index.js';

export async function login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as LoginRequest;

    if (!email || !password) {
        res.status(400).json({ error: 'Email e senha são obrigatórios' });
        return;
    }

    // Find user by email
    const result = await query<User>(
        `SELECT id, name, email, password_hash, role, avatar, professor_id, class_group, created_at, updated_at
         FROM users WHERE email = $1`,
        [email]
    );

    if (result.rows.length === 0) {
        res.status(401).json({ error: 'Email ou senha inválidos' });
        return;
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash || '');
    if (!validPassword) {
        res.status(401).json({ error: 'Email ou senha inválidos' });
        return;
    }

    // Generate JWT token
    const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' } // Fixed expiration for type safety
    );

    // Remove password_hash from response
    const { password_hash: _, ...userPublic } = user;

    const response: LoginResponse = {
        token,
        user: userPublic
    };

    res.json(response);
}

export async function getCurrentUser(req: Request, res: Response): Promise<void> {
    if (!req.user) {
        res.status(401).json({ error: 'Não autenticado' });
        return;
    }

    const result = await query<User>(
        `SELECT id, name, email, role, avatar, professor_id, class_group, created_at, updated_at
         FROM users WHERE id = $1`,
        [req.user.userId]
    );

    if (result.rows.length === 0) {
        res.status(404).json({ error: 'Usuário não encontrado' });
        return;
    }

    res.json(result.rows[0]);
}

export function logout(_req: Request, res: Response): void {
    // JWT is stateless, so we just respond with success
    // Client should remove the token
    res.json({ message: 'Logout realizado com sucesso' });
}

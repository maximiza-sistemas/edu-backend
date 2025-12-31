// User roles
export type UserRole = 'admin' | 'professor' | 'student';

// Book types (student vs professor material)
export type BookType = 'student' | 'professor';

// Curriculum components (matching frontend)
export const CURRICULUM_COMPONENTS = [
    'Matemática',
    'Língua Portuguesa',
    'Ciências',
    'História',
    'Geografia',
    'Inglês',
    'Artes',
    'Educação Física',
    'Filosofia',
    'Sociologia'
] as const;

export type CurriculumComponent = typeof CURRICULUM_COMPONENTS[number];

// Class groups (matching frontend)
export const CLASS_GROUPS = [
    '1º Ano A',
    '1º Ano B',
    '2º Ano A',
    '2º Ano B',
    '3º Ano A',
    '3º Ano B',
    '4º Ano A',
    '4º Ano B',
    '5º Ano A',
    '5º Ano B'
] as const;

export type ClassGroup = typeof CLASS_GROUPS[number];

// Database entities
export interface User {
    id: string;
    name: string;
    email: string;
    password_hash?: string;
    role: UserRole;
    avatar?: string;
    professor_id?: string;
    class_group?: ClassGroup;
    created_at: Date;
    updated_at: Date;
}

// User without sensitive data (for API responses)
export type UserPublic = Omit<User, 'password_hash'>;

export interface Book {
    id: string;
    title: string;
    author: string;
    description: string;
    cover_url: string;
    pdf_url?: string;
    curriculum_component: CurriculumComponent;
    book_type: BookType;
    class_groups?: ClassGroup[];
    created_at: Date;
    updated_at: Date;
}

export interface BookAssignment {
    id: string;
    book_id: string;
    user_id: string;
    assigned_at: Date;
    progress: number;
}

// API request/response types
export interface LoginRequest {
    email: string;
    password: string;
}

export interface LoginResponse {
    token: string;
    user: UserPublic;
}

export interface CreateUserRequest {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    professor_id?: string;
    class_group?: ClassGroup;
}

export interface UpdateUserRequest {
    name?: string;
    email?: string;
    password?: string;
    role?: UserRole;
    professor_id?: string;
    class_group?: ClassGroup;
}

export interface CreateBookRequest {
    title: string;
    author: string;
    description: string;
    cover_url: string;
    pdf_url?: string;
    curriculum_component: CurriculumComponent;
    book_type: BookType;
    class_groups: ClassGroup[];
}

export interface UpdateBookRequest {
    title?: string;
    author?: string;
    description?: string;
    cover_url?: string;
    pdf_url?: string;
    curriculum_component?: CurriculumComponent;
    book_type?: BookType;
    class_groups?: ClassGroup[];
}

export interface BookFilters {
    search?: string;
    curriculum_component?: CurriculumComponent | 'all';
    class_group?: ClassGroup | 'all';
    professor_id?: string | 'all';
    student_id?: string | 'all';
    limit?: number;
    offset?: number;
}

export interface CreateAssignmentRequest {
    book_id: string;
    user_id: string;
}

export interface UpdateAssignmentRequest {
    progress: number;
}

// JWT payload
export interface JWTPayload {
    userId: string;
    email: string;
    role: UserRole;
}

// Pagination
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    limit: number;
    offset: number;
}

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

// Controllers
import * as authController from '../controllers/authController.js';
import * as userController from '../controllers/userController.js';
import * as bookController from '../controllers/bookController.js';
import * as assignmentController from '../controllers/assignmentController.js';
import * as curriculumController from '../controllers/curriculumController.js';
import * as seriesController from '../controllers/seriesController.js';
import { uploadPdf, uploadImage, handlePdfUpload, handleImageUpload } from '../controllers/uploadController.js';

const router = Router();

// ============== Auth Routes ==============
router.post('/auth/login', asyncHandler(authController.login));
router.post('/auth/logout', authController.logout);
router.get('/auth/me', authMiddleware, asyncHandler(authController.getCurrentUser));

// ============== User Routes ==============
// Public user routes (for login purposes)
router.get('/users/role/:role', authMiddleware, asyncHandler(userController.getUsersByRole));
router.get('/users/professor/:professorId/students', authMiddleware, asyncHandler(userController.getStudentsByProfessor));

// Protected user routes (admin only for modifications)
router.get('/users', authMiddleware, asyncHandler(userController.getUsers));
router.get('/users/:id', authMiddleware, asyncHandler(userController.getUserById));
router.post('/users', authMiddleware, requireRole('admin'), asyncHandler(userController.createUser));
router.put('/users/:id', authMiddleware, requireRole('admin'), asyncHandler(userController.updateUser));
router.delete('/users/:id', authMiddleware, requireRole('admin'), asyncHandler(userController.deleteUser));

// ============== Curriculum Components Routes ==============
router.get('/curriculum-components', authMiddleware, asyncHandler(curriculumController.getCurriculumComponents));
router.get('/curriculum-components/:id', authMiddleware, asyncHandler(curriculumController.getCurriculumComponentById));
router.post('/curriculum-components', authMiddleware, requireRole('admin'), asyncHandler(curriculumController.createCurriculumComponent));
router.put('/curriculum-components/:id', authMiddleware, requireRole('admin'), asyncHandler(curriculumController.updateCurriculumComponent));
router.delete('/curriculum-components/:id', authMiddleware, requireRole('admin'), asyncHandler(curriculumController.deleteCurriculumComponent));

// ============== Series Routes ==============
router.get('/series', authMiddleware, asyncHandler(seriesController.getAllSeries));
router.get('/series/:id', authMiddleware, asyncHandler(seriesController.getSeriesById));
router.post('/series', authMiddleware, requireRole('admin'), asyncHandler(seriesController.createSeries));
router.put('/series/:id', authMiddleware, requireRole('admin'), asyncHandler(seriesController.updateSeries));
router.delete('/series/:id', authMiddleware, requireRole('admin'), asyncHandler(seriesController.deleteSeries));

// ============== Book Routes ==============
router.get('/books', authMiddleware, asyncHandler(bookController.getBooks));
router.get('/books/student/:userId', authMiddleware, asyncHandler(bookController.getBooksByStudent));
router.get('/books/component/:component', authMiddleware, asyncHandler(bookController.getBooksByComponent));
router.get('/books/class/:classGroup', authMiddleware, asyncHandler(bookController.getBooksByClass));
router.get('/books/:id', authMiddleware, asyncHandler(bookController.getBookById));
router.post('/books', authMiddleware, requireRole('admin'), asyncHandler(bookController.createBook));
router.put('/books/:id', authMiddleware, requireRole('admin'), asyncHandler(bookController.updateBook));
router.delete('/books/:id', authMiddleware, requireRole('admin'), asyncHandler(bookController.deleteBook));

// ============== Upload Routes ==============
router.post('/upload/pdf', authMiddleware, requireRole('admin'), uploadPdf.single('pdf'), asyncHandler(handlePdfUpload));
router.post('/upload/image', authMiddleware, requireRole('admin'), uploadImage.single('image'), asyncHandler(handleImageUpload));

// ============== Assignment Routes ==============
router.get('/assignments', authMiddleware, asyncHandler(assignmentController.getAssignments));
router.get('/assignments/:id', authMiddleware, asyncHandler(assignmentController.getAssignmentById));
router.get('/assignments/user/:userId', authMiddleware, asyncHandler(assignmentController.getAssignmentsByUser));
router.get('/assignments/book/:bookId', authMiddleware, asyncHandler(assignmentController.getAssignmentsByBook));
router.post('/assignments', authMiddleware, requireRole('admin', 'professor'), asyncHandler(assignmentController.createAssignment));
router.put('/assignments/:id', authMiddleware, asyncHandler(assignmentController.updateAssignment));
router.put('/assignments/book/:bookId/user/:userId/progress', authMiddleware, asyncHandler(assignmentController.updateProgressByBookAndUser));
router.delete('/assignments/:id', authMiddleware, requireRole('admin', 'professor'), asyncHandler(assignmentController.deleteAssignment));
router.delete('/assignments/book/:bookId/user/:userId', authMiddleware, requireRole('admin', 'professor'), asyncHandler(assignmentController.deleteAssignmentByBookAndUser));

export default router;

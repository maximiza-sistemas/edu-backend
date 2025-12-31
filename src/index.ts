import express from 'express';
import cors from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { checkConnection } from './config/database.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// ============== Middleware ==============

// CORS - Allow frontend to access API
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true
}));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Rate limiting to prevent CPU overload
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições, tente novamente mais tarde.' }
});
app.use(limiter);

// ============== Static Files (Uploads) ==============
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ============== Health Check ==============
app.get('/api/health', async (_req, res) => {
    const dbConnected = await checkConnection();
    res.json({
        status: 'ok',
        database: dbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// ============== API Routes ==============
app.use('/api', routes);

// ============== Error Handling ==============
app.use(notFoundHandler);
app.use(errorHandler);

// ============== Start Server ==============
async function startServer() {
    // Check database connection
    const dbConnected = await checkConnection();
    if (!dbConnected) {
        console.error('❌ Failed to connect to database. Exiting...');
        process.exit(1);
    }
    console.log('✅ Database connected');

    app.listen(PORT, () => {
        console.log(`
🚀 Educação Maxi API Server running!
   
   Local:    http://localhost:${PORT}
   Health:   http://localhost:${PORT}/api/health
   
   Environment: ${process.env.NODE_ENV || 'development'}
        `);
    });
}

startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

export default app;

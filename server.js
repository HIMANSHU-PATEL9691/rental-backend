const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const multer = require('multer');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

let dbReady = false;
let dbError = null;

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    console.warn(`[cors] Blocked request from origin: ${origin}`);
    callback(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    database: dbReady ? 'connected' : 'connecting',
    databaseError: dbError,
    timestamp: new Date().toISOString(),
  });
});


app.use('/api', (req, res, next) => {
  console.log(`[api] ${req.method} ${req.originalUrl}`);

  if (dbReady) {
    next();
    return;
  }

  res.status(503).json({
    error: dbError || 'Database is still connecting. Please try again in a moment.',
  });
});

// Routes
const authController = require('./controllers/authController');
// Staff management endpoints used by the Staff Report page
app.get('/api/auth/users', authController.getUsers);
app.put('/api/auth/users/:identifier/status', authController.updateUserStatus);
app.delete('/api/auth/users/:identifier', authController.deleteUser);

// Auth routes (signup/login)
app.use('/api/auth', require('./routes/auth'));


app.use('/api/items', require('./routes/items'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/rentals', require('./routes/rentals'));
app.use('/api/bills', require('./routes/bills'));




// 404
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`API health: http://localhost:${PORT}/health`);
});

// MongoDB Connect
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    dbReady = true;
    dbError = null;
    console.log('Connected to MongoDB Atlas');
  })
  .catch((err) => {
    dbReady = false;
    dbError = `MongoDB connection error: ${err.message}`;
    console.error(dbError);
  });

module.exports = app;

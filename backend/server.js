const express = require('express');
const cors = require('cors');
const path = require('path');
// Production: .env sits alongside server.js in /opt/commie
// Development: .env sits one level up at the project root
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { checkAndNotifyVotingDeadlines } = require('./utils/votingDeadlineNotifications');

// Import routes
const authRoutes = require('./routes/auth');
const committeeRoutes = require('./routes/committees');
const motionRoutes = require('./routes/motions');
const commentRoutes = require('./routes/comments');
const voteRoutes = require('./routes/votes');
const notificationsRoutes = require('./routes/notifications');
const motionControlRoutes = require('./routes/motionControl');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    // Allow localhost for development
    if (origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }

    // Allow all origins if CORS_ORIGIN is wildcard
    if (process.env.CORS_ORIGIN === '*') {
      return callback(null, true);
    }

    // Allow specific origin from env variable
    if (process.env.CORS_ORIGIN && origin === process.env.CORS_ORIGIN) {
      return callback(null, true);
    }

    console.warn('CORS rejected origin:', origin);
    callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// API Routes
app.use('/auth', authRoutes);
app.use('/', committeeRoutes);
app.use('/', motionRoutes);
app.use('/', commentRoutes);
app.use('/', voteRoutes);
app.use('/', notificationsRoutes);
app.use('/motion-control', motionControlRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

async function startServer() {
  try {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });

    // Start periodic voting deadline check (every 30 minutes)
    checkAndNotifyVotingDeadlines();
    setInterval(checkAndNotifyVotingDeadlines, 30 * 60 * 1000);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

process.on('SIGINT', async () => {
  process.exit(0);
});

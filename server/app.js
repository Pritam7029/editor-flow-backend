const express = require('express');
const http = require('http');
const { initSocketServer } = require('./src/realtime/socketServer');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./src/config/env');

const healthRoutes = require('./src/routes/health.routes');
const meRoutes = require('./src/routes/me.routes');
const profileRoutes = require('./src/routes/profile.routes');
const workspaceRoutes = require('./src/routes/workspace.routes');
const inviteRoutes = require('./src/routes/invite.routes');
const taskRoutes = require('./src/routes/task.routes');
const fileRoutes = require('./src/routes/file.routes');
const chatRoutes = require('./src/routes/chat.routes');
const deviceKeyRoutes = require('./src/routes/deviceKey.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const sessionRoutes = require('./src/routes/session.routes');
const billingRoutes = require('./src/routes/billing.routes');
const joinRoutes = require('./src/routes/join.routes');

const { apiLimiter } = require('./src/middleware/rateLimiter');
const notFound = require('./src/middleware/notFound');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

app.use(helmet());

// Allow dynamic CORS origins from CLIENT_URLS array, support credentials
const allowedOrigins = env.CLIENT_URLS || [env.CLIENT_URL];
app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps, curl, or server-to-server)
            if (!origin) return callback(null, true);
            
            const normalizedOrigin = origin.replace(/\/+$/, '');
            
            // Check exact match in configured allowed origins
            if (allowedOrigins.includes(normalizedOrigin)) {
                return callback(null, true);
            }
            
            // Support Vercel preview deployments if any allowed origin is on Vercel
            const hasVercelAllowed = allowedOrigins.some(url => url.includes('.vercel.app'));
            if (hasVercelAllowed && normalizedOrigin.endsWith('.vercel.app')) {
                return callback(null, true);
            }
            
            // Allow localhost during development or testing
            if (env.NODE_ENV !== 'production' && (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:'))) {
                return callback(null, true);
            }
            
            return callback(null, false);
        },
        credentials: true
    })
);

app.use(express.json({ 
    limit: '1mb',
    verify: (req, res, buf) => {
        if (req.originalUrl && (req.originalUrl.includes('/webhooks/stripe') || req.originalUrl.includes('/webhooks/razorpay'))) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true }));

if (env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

app.use(apiLimiter);

app.use(healthRoutes);
app.use('/api', meRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api', billingRoutes);
app.use('/api', joinRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/device-keys', deviceKeyRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workspaces/:workspaceId', taskRoutes);
app.use('/api/workspaces/:workspaceId', fileRoutes);
app.use('/api/workspaces/:workspaceId', chatRoutes);
app.use('/api/workspaces/:workspaceId', notificationRoutes);
app.use('/api/invites', inviteRoutes);

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSocketServer(server, app);

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    server.listen(env.PORT, () => {
        console.log(`EditorFlow backend running on port ${env.PORT}`);
    });
}

module.exports = app;
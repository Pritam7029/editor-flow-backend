const express = require('express');
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

const { apiLimiter } = require('./src/middleware/rateLimiter');
const notFound = require('./src/middleware/notFound');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

app.use(helmet());

app.use(
    cors({
        origin: env.CLIENT_URL,
        credentials: true
    })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

app.use(apiLimiter);

app.use(healthRoutes);
app.use('/api', meRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workspaces/:workspaceId', taskRoutes);
app.use('/api/workspaces/:workspaceId', fileRoutes);
app.use('/api/invites', inviteRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(env.PORT, () => {
    console.log(`EditorFlow backend running on port ${env.PORT}`);
});
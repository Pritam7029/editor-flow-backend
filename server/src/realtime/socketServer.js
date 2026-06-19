const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const socketAuth = require('./socketAuth');
const { registerSocketEvents } = require('./socketEvents');
const { getRedisClient } = require('./presence.service');
const env = require('../config/env');

function initSocketServer(httpServer, app) {
    const allowedOrigins = env.CLIENT_URLS || [env.CLIENT_URL];
    const io = new Server(httpServer, {
        cors: {
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
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    const redisClient = getRedisClient();
    if (redisClient) {
        try {
            const subClient = redisClient.duplicate();
            subClient.connect().then(() => {
                io.adapter(createAdapter(redisClient, subClient));
                console.log('Socket.IO Redis Adapter configured successfully');
            }).catch(err => {
                console.error('Failed to connect Socket.IO Redis sub client:', err.message);
            });
        } catch (err) {
            console.error('Failed to duplicate Redis client for adapter:', err.message);
        }
    }

    io.use(socketAuth);

    io.on('connection', (socket) => {
        if (socket.user) {
            console.log(`Socket connected: ${socket.id} (User: ${socket.user.email})`);
            
            // Join default user-specific room
            socket.join(`user:${socket.user.id}`);
            
            // Join device-specific room if a device key is present
            if (socket.deviceKey && socket.deviceKey.id) {
                socket.join(`device:${socket.deviceKey.id}`);
            }

            registerSocketEvents(io, socket);
        } else {
            console.log('Socket connection without user object, disconnecting.');
            socket.disconnect(true);
        }
    });

    // Make io accessible globally in express routing handlers
    app.set('socketio', io);

    return io;
}

module.exports = {
    initSocketServer
};

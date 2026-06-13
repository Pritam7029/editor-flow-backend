const redis = require('redis');
const env = require('../config/env');

let redisClient = null;
const memoryStore = new Map();

// Helper: Periodically clean up expired memory keys
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of memoryStore.entries()) {
        if (val && val.expires && val.expires < now) {
            memoryStore.delete(key);
        }
    }
}, 5000);

async function initRedis() {
    const redisUrl = process.env.REDIS_URL || env.REDIS_URL;
    if (redisUrl) {
        try {
            redisClient = redis.createClient({ url: redisUrl });
            redisClient.on('error', (err) => {
                console.error('Redis Client Error:', err.message);
            });
            await redisClient.connect();
            console.log('Connected to Redis for presence and adapter scaling');
        } catch (err) {
            console.error('Failed to connect to Redis. Falling back to in-memory stores.', err.message);
            redisClient = null;
        }
    }
}

// Initialize Redis immediately (catch error to prevent crash)
initRedis().catch(err => {
    console.error('Redis init failed:', err.message);
});

function getRedisClient() {
    return redisClient;
}

async function setUserOnline(userId, workspaceId) {
    const key = `presence:ws:${workspaceId}:u:${userId}`;
    if (redisClient) {
        try {
            await redisClient.set(key, 'online', { EX: 60 });
        } catch (e) {
            console.error('Redis set presence failed, using memory fallback:', e.message);
            memoryStore.set(key, { status: 'online', expires: Date.now() + 60000 });
        }
    } else {
        memoryStore.set(key, { status: 'online', expires: Date.now() + 60000 });
    }
}

async function setUserOffline(userId, workspaceId) {
    const key = `presence:ws:${workspaceId}:u:${userId}`;
    if (redisClient) {
        try {
            await redisClient.del(key);
        } catch (e) {
            memoryStore.delete(key);
        }
    } else {
        memoryStore.delete(key);
    }
}

async function getOnlineUsers(workspaceId) {
    const prefix = `presence:ws:${workspaceId}:u:`;
    const onlineUsers = [];

    if (redisClient) {
        try {
            const keys = await redisClient.keys(`${prefix}*`);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const parts = key.split(':');
                const userId = parts[parts.length - 1];
                onlineUsers.push(userId);
            }
            return onlineUsers;
        } catch (e) {
            console.error('Redis keys presence failed, using memory fallback:', e.message);
        }
    }

    // Memory fallback
    const now = Date.now();
    for (const [key, val] of memoryStore.entries()) {
        if (key.startsWith(prefix)) {
            if (val && val.expires && val.expires >= now) {
                const parts = key.split(':');
                const userId = parts[parts.length - 1];
                onlineUsers.push(userId);
            }
        }
    }

    return onlineUsers;
}

async function setTypingState(threadId, userId, isTyping) {
    const key = `typing:thread:${threadId}:u:${userId}`;
    if (isTyping) {
        if (redisClient) {
            try {
                await redisClient.set(key, 'typing', { EX: 10 });
            } catch (e) {
                memoryStore.set(key, { expires: Date.now() + 10000 });
            }
        } else {
            memoryStore.set(key, { expires: Date.now() + 10000 });
        }
    } else {
        if (redisClient) {
            try {
                await redisClient.del(key);
            } catch (e) {
                memoryStore.delete(key);
            }
        } else {
            memoryStore.delete(key);
        }
    }
}

async function getTypingUsers(threadId) {
    const prefix = `typing:thread:${threadId}:u:`;
    const typingUsers = [];

    if (redisClient) {
        try {
            const keys = await redisClient.keys(`${prefix}*`);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const parts = key.split(':');
                const userId = parts[parts.length - 1];
                typingUsers.push(userId);
            }
            return typingUsers;
        } catch (e) {
            console.error('Redis keys typing failed, using memory fallback:', e.message);
        }
    }

    const now = Date.now();
    for (const [key, val] of memoryStore.entries()) {
        if (key.startsWith(prefix)) {
            if (val && val.expires && val.expires >= now) {
                const parts = key.split(':');
                const userId = parts[parts.length - 1];
                typingUsers.push(userId);
            }
        }
    }

    return typingUsers;
}

module.exports = {
    getRedisClient,
    setUserOnline,
    setUserOffline,
    getOnlineUsers,
    setTypingState,
    getTypingUsers
};

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const isDev = env.NODE_ENV === 'development';

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isDev ? 999999 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests. Please try again later.'
    }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isDev ? 999999 : 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests. Please try again later.'
    }
});

module.exports = {
    apiLimiter,
    strictLimiter
};
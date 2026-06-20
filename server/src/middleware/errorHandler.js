const env = require('../config/env');

function errorHandler(error, req, res, next) {
    const statusCode = error.statusCode || 500;

    const response = {
        success: false,
        message: error.message || 'Internal server error'
    };

    if (error.details) {
        response.details = error.details;
    }

    if (env.NODE_ENV === 'development') {
        response.stack = error.stack;
    }

    return res.status(statusCode).json(response);
}

module.exports = errorHandler;
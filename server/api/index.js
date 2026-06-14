let app;
let initError;

try {
    app = require('../app');
} catch (err) {
    console.error('Failed to initialize app:', err.message);
    console.error(err.stack);
    initError = err;
}

module.exports = (req, res) => {
    if (initError) {
        res.status(500).json({
            error: 'App failed to initialize',
            message: initError.message,
            stack: initError.stack
        });
        return;
    }
    return app(req, res);
};

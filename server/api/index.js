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
        // Log which env vars are present (names only, not values)
        const envKeys = Object.keys(process.env).filter(k =>
            ['CLIENT_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
             'NODE_ENV', 'PORT', 'RESEND_API_KEY', 'EMAIL_FROM',
             'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'].includes(k)
        );

        res.status(500).json({
            error: 'App failed to initialize',
            message: initError.message,
            stack: initError.stack,
            envVarsPresent: envKeys,
            envVarsValues: envKeys.reduce((acc, k) => {
                const val = process.env[k];
                // Show type and length, not actual value
                acc[k] = val === undefined ? 'UNDEFINED' : val === '' ? 'EMPTY_STRING' : `SET (${val.length} chars)`;
                return acc;
            }, {})
        });
        return;
    }
    return app(req, res);
};

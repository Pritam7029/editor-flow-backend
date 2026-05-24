const { supabaseAnon } = require('../config/supabase');

async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Missing authorization token'
            });
        }

        const token = authHeader.replace('Bearer ', '').trim();

        const { data, error } = await supabaseAnon.auth.getUser(token);

        if (error || !data || !data.user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        req.user = data.user;

        next();
    } catch (error) {
        next(error);
    }
}

module.exports = {
    requireAuth
};
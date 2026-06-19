const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const env = require('./env');

// Polyfill WebSocket for Node.js < 22 environments where it is not native
if (typeof global.WebSocket === 'undefined') {
    global.WebSocket = ws;
}

const supabaseAnon = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY,
    {
        realtime: {
            transport: ws
        }
    }
);

const supabaseAdmin = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        realtime: {
            transport: ws
        }
    }
);

module.exports = {
    supabaseAnon,
    supabaseAdmin
};
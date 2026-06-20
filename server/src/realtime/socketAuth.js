const { supabaseAnon } = require('../config/supabase');
const { getDeviceKeyById } = require('../services/deviceKey.service');

async function socketAuth(socket, next) {
    try {
        const token = socket.handshake.auth && socket.handshake.auth.token 
            ? socket.handshake.auth.token 
            : socket.handshake.query && socket.handshake.query.token;
            
        const deviceKeyId = socket.handshake.auth && socket.handshake.auth.deviceKeyId
            ? socket.handshake.auth.deviceKeyId
            : socket.handshake.query && socket.handshake.query.deviceKeyId;

        if (!token) {
            return next(new Error('Authentication token is required'));
        }

        const { data, error } = await supabaseAnon.auth.getUser(token);
        if (error || !data || !data.user) {
            return next(new Error('Invalid or expired authentication token'));
        }

        if (deviceKeyId) {
            const deviceKey = await getDeviceKeyById(deviceKeyId);
            if (!deviceKey || deviceKey.user_id !== data.user.id || deviceKey.status !== 'active') {
                return next(new Error('Invalid or revoked device key'));
            }
            socket.deviceKey = deviceKey;
        }

        socket.user = data.user;
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = socketAuth;

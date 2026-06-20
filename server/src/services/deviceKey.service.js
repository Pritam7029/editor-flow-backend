const { supabaseAdmin } = require('../config/supabase');

async function registerDeviceKey(userId, { deviceName, publicKey, algorithm }) {
    // Check if the exact key already exists to prevent duplicate registrations
    const { data: existing, error: checkError } = await supabaseAdmin
        .from('user_device_keys')
        .select('id')
        .eq('user_id', userId)
        .eq('public_key', publicKey)
        .eq('status', 'active')
        .maybeSingle();

    if (checkError) throw checkError;

    if (existing) {
        return existing;
    }

    const { data, error } = await supabaseAdmin
        .from('user_device_keys')
        .insert({
            user_id: userId,
            device_name: deviceName,
            public_key: publicKey,
            algorithm: algorithm || 'RSA-OAEP',
            status: 'active'
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getDeviceKeys(userId) {
    const { data, error } = await supabaseAdmin
        .from('user_device_keys')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

async function getDeviceKeyById(deviceKeyId) {
    const { data, error } = await supabaseAdmin
        .from('user_device_keys')
        .select('*')
        .eq('id', deviceKeyId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

async function revokeDeviceKey(userId, deviceKeyId) {
    const { data, error } = await supabaseAdmin
        .from('user_device_keys')
        .update({ status: 'revoked' })
        .eq('id', deviceKeyId)
        .eq('user_id', userId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

module.exports = {
    registerDeviceKey,
    getDeviceKeys,
    getDeviceKeyById,
    revokeDeviceKey
};

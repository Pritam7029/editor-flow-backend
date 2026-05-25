const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/me', requireAuth, async(req, res, next) => {
    try {
        const user = req.user;

        const profilePayload = {
            id: user.id,
            email: user.email,
            full_name: user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) ?
                user.user_metadata.full_name || user.user_metadata.name :
                null,
            avatar_url: user.user_metadata && user.user_metadata.avatar_url ?
                user.user_metadata.avatar_url :
                null
        };

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert(profilePayload, {
                onConflict: 'id'
            })
            .select()
            .single();

        if (profileError) {
            throw profileError;
        }

        let { data: preferences, error: preferencesError } = await supabaseAdmin
            .from('user_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        if (preferencesError) {
            throw preferencesError;
        }

        if (!preferences) {
            const { data: createdPreferences, error: createPreferencesError } =
            await supabaseAdmin
                .from('user_preferences')
                .insert({
                    user_id: user.id
                })
                .select()
                .single();

            if (createPreferencesError) {
                throw createPreferencesError;
            }

            preferences = createdPreferences;
        }

        return res.status(200).json({
            success: true,
            message: 'Profile fetched successfully',
            data: {
                profile,
                preferences
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
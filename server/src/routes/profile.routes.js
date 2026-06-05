const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/me', requireAuth, async(req, res, next) => {
    try {
        const user = req.user;

        let { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError) {
            throw profileError;
        }

        if (!profile) {
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

            const { data: newProfile, error: createError } = await supabaseAdmin
                .from('profiles')
                .insert(profilePayload)
                .select()
                .single();

            if (createError) {
                throw createError;
            }
            profile = newProfile;
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

/**
 * PATCH /api/profile/me
 * Update the logged-in user's profile details
 */
router.patch('/me', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { name, color, role, bio, status, avatarUrl } = req.body;

        const updatePayload = {};
        if (name !== undefined) updatePayload.full_name = name;
        if (color !== undefined) updatePayload.color = color;
        if (role !== undefined) updatePayload.role = role;
        if (bio !== undefined) updatePayload.bio = bio;
        if (status !== undefined) updatePayload.status = status;
        if (avatarUrl !== undefined) updatePayload.avatar_url = avatarUrl;
        
        updatePayload.updated_at = new Date();

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .update(updatePayload)
            .eq('id', userId)
            .select()
            .single();

        if (profileError) {
            throw profileError;
        }

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                profile
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
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

        // Fetch or create billing account & plan
        let { data: billingAccount, error: baError } = await supabaseAdmin
            .from('billing_accounts')
            .select('*, plan:plans(*)')
            .eq('owner_id', user.id)
            .maybeSingle();

        if (baError) {
            throw baError;
        }

        if (!billingAccount) {
            // Auto onboard to free plan if none exists
            const { data: newAccount, error: createError } = await supabaseAdmin
                .from('billing_accounts')
                .insert({
                    owner_id: user.id,
                    plan_key: 'free',
                    status: 'active'
                })
                .select('*, plan:plans(*)')
                .maybeSingle();

            if (!createError && newAccount) {
                billingAccount = newAccount;
            }
        }

        let plan = billingAccount && billingAccount.plan;
        if (!plan) {
            plan = {
                key: 'free',
                name: 'Free',
                max_storage_bytes: 2147483648,
                max_workspaces: 1,
                max_members: 4
            };
        }

        // Calculate storage usage
        const { data: workspaces, error: wsError } = await supabaseAdmin
            .from('workspaces')
            .select('id')
            .eq('owner_id', user.id);
        
        const workspaceIds = (workspaces || []).map(w => w.id);
        
        let query = supabaseAdmin
            .from('files')
            .select('size_bytes')
            .eq('status', 'ready');
        
        if (workspaceIds.length > 0) {
            query = query.or(`uploaded_by.eq.${user.id},workspace_id.in.(${workspaceIds.map(id => `"${id}"`).join(',')})`);
        } else {
            query = query.eq('uploaded_by', user.id);
        }
        
        const { data: files, error: filesError } = await query;
        
        let storageUsedBytes = 0;
        if (!filesError && files) {
            storageUsedBytes = files.reduce((acc, f) => acc + Number(f.size_bytes || 0), 0);
        }

        const storageLimitBytes = plan.max_storage_bytes || 2147483648;
        const storagePercent = storageLimitBytes > 0 ? (storageUsedBytes / storageLimitBytes) * 100 : 0;

        return res.status(200).json({
            success: true,
            message: 'Profile fetched successfully',
            data: {
                profile,
                preferences,
                plan,
                storageUsedBytes,
                storageLimitBytes,
                storagePercent
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
        const { name, color, role, bio, status, avatarUrl, avatar_url, avatar_storage_path } = req.body;

        const updatePayload = {};
        if (name !== undefined) updatePayload.full_name = name;
        if (color !== undefined) updatePayload.color = color;
        if (role !== undefined) updatePayload.role = role;
        if (bio !== undefined) updatePayload.bio = bio;
        if (status !== undefined) updatePayload.status = status;
        if (avatarUrl !== undefined) updatePayload.avatar_url = avatarUrl;
        if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;
        if (avatar_storage_path !== undefined) updatePayload.avatar_storage_path = avatar_storage_path;
        
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

/**
 * POST /api/profile/avatar/init-upload
 * Initialize avatar image upload by creating a signed upload URL.
 */
router.post('/avatar/init-upload', requireAuth, async (req, res, next) => {
    try {
        const { name, mime_type, size_bytes } = req.body;
        
        if (!mime_type || !['image/jpeg', 'image/png', 'image/webp'].includes(mime_type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid file type. Only JPEG, PNG and WEBP images are allowed.'
            });
        }
        
        if (!size_bytes || size_bytes > 5 * 1024 * 1024) {
            return res.status(400).json({
                success: false,
                message: 'File size exceeds 5 MB limit.'
            });
        }

        const userId = req.user.id;
        const timestamp = Date.now();
        const extension = mime_type.split('/')[1] || 'jpg';
        const storagePath = `${userId}/avatar-${timestamp}.${extension}`;
        
        // Ensure avatars bucket exists
        try {
            await supabaseAdmin.storage.createBucket('avatars', {
                public: true,
                fileSizeLimit: 5242880,
                allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
            });
        } catch (bucketErr) {
            // Ignore if already exists
        }

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('avatars')
            .createSignedUploadUrl(storagePath);
            
        if (uploadError || !uploadData) {
            throw uploadError || new Error('Failed to generate signed upload URL');
        }
        
        return res.status(200).json({
            success: true,
            message: 'Avatar upload initialized successfully',
            data: {
                bucket: 'avatars',
                storagePath,
                signedUrl: uploadData.signedUrl,
                token: uploadData.token
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/profile/avatar/complete-upload
 * Commit the uploaded avatar's storage path and URL to profiles.
 */
router.post('/avatar/complete-upload', requireAuth, async (req, res, next) => {
    try {
        const { storagePath } = req.body;
        if (!storagePath) {
            return res.status(400).json({
                success: false,
                message: 'storagePath is required'
            });
        }
        
        const userId = req.user.id;
        
        const { data } = supabaseAdmin.storage
            .from('avatars')
            .getPublicUrl(storagePath);
            
        const avatarUrl = data ? data.publicUrl : null;
        
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({
                avatar_storage_path: storagePath,
                avatar_url: avatarUrl,
                updated_at: new Date()
            })
            .eq('id', userId)
            .select()
            .single();
            
        if (profileError) {
            throw profileError;
        }
        
        return res.status(200).json({
            success: true,
            message: 'Avatar upload completed successfully',
            data: {
                profile
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
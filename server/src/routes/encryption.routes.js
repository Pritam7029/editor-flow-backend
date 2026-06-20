const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const validate = require('../validators/validate');
const {
    setupEncryptionIdentitySchema,
    patchRecoveryAnswerSchema
} = require('../validators/encryption.validators');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/encryption/identity
 * Fetch caller's encryption identity metadata (public key, salt, questions, etc.)
 */
router.get('/identity', async (req, res, next) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('user_encryption_identities')
            .select('*')
            .eq('user_id', req.user.id)
            .maybeSingle();

        if (error) throw error;

        // If no identity exists, return null
        if (!data) {
            return res.status(200).json({
                success: true,
                data: { identity: null }
            });
        }

        // Return camelCase fields to match frontend API expectations
        const identity = {
            id: data.id,
            userId: data.user_id,
            publicKey: data.public_key,
            encryptedPrivateKey: data.encrypted_private_key,
            privateKeyIv: data.private_key_iv,
            kdfAlgorithm: data.kdf_algorithm,
            kdfSalt: data.kdf_salt,
            kdfIterations: data.kdf_iterations,
            keyAlgorithm: data.key_algorithm,
            recoveryQuestionKey: data.recovery_question_key,
            recoveryQuestionText: data.recovery_question_text,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };

        return res.status(200).json({
            success: true,
            data: { identity }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/encryption/identity
 * Setup encryption identity for first time
 */
router.post('/identity', validate(setupEncryptionIdentitySchema), async (req, res, next) => {
    try {
        const {
            publicKey,
            encryptedPrivateKey,
            privateKeyIv,
            kdfSalt,
            kdfIterations,
            kdfAlgorithm,
            keyAlgorithm,
            recoveryQuestionKey,
            recoveryQuestionText
        } = req.validated.body;

        const { data, error } = await supabaseAdmin
            .from('user_encryption_identities')
            .insert({
                user_id: req.user.id,
                public_key: publicKey,
                encrypted_private_key: encryptedPrivateKey,
                private_key_iv: privateKeyIv,
                kdf_algorithm: kdfAlgorithm || 'PBKDF2',
                kdf_salt: kdfSalt,
                kdf_iterations: kdfIterations || 600000,
                key_algorithm: keyAlgorithm || 'RSA-OAEP',
                recovery_question_key: recoveryQuestionKey,
                recovery_question_text: recoveryQuestionText
            })
            .select()
            .single();

        if (error) throw error;

        const identity = {
            id: data.id,
            userId: data.user_id,
            publicKey: data.public_key,
            encryptedPrivateKey: data.encrypted_private_key,
            privateKeyIv: data.private_key_iv,
            kdfAlgorithm: data.kdf_algorithm,
            kdfSalt: data.kdf_salt,
            kdfIterations: data.kdf_iterations,
            keyAlgorithm: data.key_algorithm,
            recoveryQuestionKey: data.recovery_question_key,
            recoveryQuestionText: data.recovery_question_text,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };

        return res.status(201).json({
            success: true,
            message: 'Encryption identity configured successfully',
            data: { identity }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/encryption/identity/recovery-answer
 * Update user's recovery question or recovery answer (re-encrypted key)
 */
router.patch('/identity/recovery-answer', validate(patchRecoveryAnswerSchema), async (req, res, next) => {
    try {
        const {
            encryptedPrivateKey,
            privateKeyIv,
            kdfSalt,
            kdfIterations,
            recoveryQuestionKey,
            recoveryQuestionText
        } = req.validated.body;

        const { data, error } = await supabaseAdmin
            .from('user_encryption_identities')
            .update({
                encrypted_private_key: encryptedPrivateKey,
                private_key_iv: privateKeyIv,
                kdf_salt: kdfSalt,
                kdf_iterations: kdfIterations || 600000,
                recovery_question_key: recoveryQuestionKey,
                recovery_question_text: recoveryQuestionText,
                updated_at: new Date()
            })
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        const identity = {
            id: data.id,
            userId: data.user_id,
            publicKey: data.public_key,
            encryptedPrivateKey: data.encrypted_private_key,
            privateKeyIv: data.private_key_iv,
            kdfAlgorithm: data.kdf_algorithm,
            kdfSalt: data.kdf_salt,
            kdfIterations: data.kdf_iterations,
            keyAlgorithm: data.key_algorithm,
            recoveryQuestionKey: data.recovery_question_key,
            recoveryQuestionText: data.recovery_question_text,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };

        return res.status(200).json({
            success: true,
            message: 'Recovery question and answer updated successfully',
            data: { identity }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/encryption/identity
 * Reset encryption identity (Admin/Owner warning)
 */
router.delete('/identity', async (req, res, next) => {
    try {
        const { error } = await supabaseAdmin
            .from('user_encryption_identities')
            .delete()
            .eq('user_id', req.user.id);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Encryption identity reset successfully. You must configure a new recovery passphrase.',
            data: null
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const validate = require('../validators/validate');
const { registerDeviceKeySchema } = require('../validators/deviceKey.validators');
const {
    registerDeviceKey,
    getDeviceKeys,
    revokeDeviceKey
} = require('../services/deviceKey.service');

const router = express.Router();

router.use(requireAuth);

/**
 * POST /api/device-keys
 * Register user's device public key
 */
router.post('/', validate(registerDeviceKeySchema), async (req, res, next) => {
    try {
        const { deviceName, publicKey, algorithm } = req.validated.body;
        const deviceKey = await registerDeviceKey(req.user.id, { deviceName, publicKey, algorithm });
        return res.status(201).json({
            success: true,
            message: 'Device key registered successfully',
            data: { deviceKey }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/device-keys/me
 * Retrieve caller's registered device keys
 */
router.get('/me', async (req, res, next) => {
    try {
        const deviceKeys = await getDeviceKeys(req.user.id);
        return res.status(200).json({
            success: true,
            data: { deviceKeys }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/device-keys/:deviceKeyId/revoke
 * Revoke own device key
 */
router.patch('/:deviceKeyId/revoke', async (req, res, next) => {
    try {
        const { deviceKeyId } = req.params;
        const deviceKey = await revokeDeviceKey(req.user.id, deviceKeyId);
        return res.status(200).json({
            success: true,
            message: 'Device key revoked successfully',
            data: { deviceKey }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;

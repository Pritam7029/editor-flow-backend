const { z } = require('zod');

const registerDeviceKeySchema = z.object({
    body: z.object({
        deviceName: z.string().trim().min(1, 'Device name is required'),
        publicKey: z.string().trim().min(1, 'Public key JWK string is required'),
        algorithm: z.string().trim().default('RSA-OAEP')
    }),
    params: z.any().optional(),
    query: z.any().optional()
});

module.exports = {
    registerDeviceKeySchema
};

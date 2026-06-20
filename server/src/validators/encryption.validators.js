const { z } = require('zod');

const setupEncryptionIdentitySchema = z.object({
    body: z.object({
        publicKey: z.string().min(1, 'Public key is required'),
        encryptedPrivateKey: z.string().min(1, 'Encrypted private key is required'),
        privateKeyIv: z.string().min(1, 'IV is required'),
        kdfSalt: z.string().min(1, 'Salt is required'),
        kdfIterations: z.number().int().min(1000, 'Iterations must be at least 1000'),
        kdfAlgorithm: z.string().default('PBKDF2'),
        keyAlgorithm: z.string().default('RSA-OAEP'),
        recoveryQuestionKey: z.string().min(1, 'Recovery question key is required'),
        recoveryQuestionText: z.string().min(1, 'Recovery question text is required')
    })
});

const patchRecoveryAnswerSchema = z.object({
    body: z.object({
        encryptedPrivateKey: z.string().min(1, 'Encrypted private key is required'),
        privateKeyIv: z.string().min(1, 'IV is required'),
        kdfSalt: z.string().min(1, 'Salt is required'),
        kdfIterations: z.number().int().min(1000, 'Iterations must be at least 1000'),
        recoveryQuestionKey: z.string().min(1, 'Recovery question key is required'),
        recoveryQuestionText: z.string().min(1, 'Recovery question text is required')
    })
});

module.exports = {
    setupEncryptionIdentitySchema,
    patchRecoveryAnswerSchema
};

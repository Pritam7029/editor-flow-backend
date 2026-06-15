const { z } = require('zod');
require('dotenv').config();

const DEFAULT_CLIENT_URL = 'http://localhost:5173';

// Log raw CLIENT_URL for debugging deployment issues
console.log('[env] Raw CLIENT_URL from process.env:', JSON.stringify(process.env.CLIENT_URL));

const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),

    PORT: z.coerce.number().default(3001),

    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional()
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    const fieldErrors = parsedEnv.error.flatten().fieldErrors;
    console.error('Invalid environment variables:', JSON.stringify(fieldErrors));
    throw new Error(
        'Missing or invalid environment variables: ' +
        Object.keys(fieldErrors).join(', ')
    );
}

// Handle CLIENT_URL separately — never let it crash the app
let clientUrl = DEFAULT_CLIENT_URL;
const rawClientUrl = (process.env.CLIENT_URL || '').trim();
if (rawClientUrl) {
    try {
        new URL(rawClientUrl); // validate it's a real URL
        clientUrl = rawClientUrl;
    } catch {
        console.warn(`⚠️  CLIENT_URL "${rawClientUrl}" is not a valid URL — using default: ${DEFAULT_CLIENT_URL}`);
    }
} else {
    console.warn(`⚠️  CLIENT_URL is not set — using default: ${DEFAULT_CLIENT_URL}`);
}

module.exports = {
    ...parsedEnv.data,
    CLIENT_URL: clientUrl
};
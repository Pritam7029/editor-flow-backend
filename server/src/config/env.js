const { z } = require('zod');
require('dotenv').config();

const DEFAULT_CLIENT_URL = 'http://localhost:5173';

const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),

    PORT: z.coerce.number().default(3001),

    CLIENT_URL: z.preprocess(
        (val) => (val === '' || val === undefined ? undefined : val),
        z.string().url().optional().default(DEFAULT_CLIENT_URL)
    ),

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

// Warn if CLIENT_URL is using the default in production
if (parsedEnv.data.NODE_ENV === 'production' && parsedEnv.data.CLIENT_URL === DEFAULT_CLIENT_URL) {
    console.warn('⚠️  WARNING: CLIENT_URL is not set — using default localhost. Set CLIENT_URL in your environment variables for production.');
}

module.exports = parsedEnv.data;
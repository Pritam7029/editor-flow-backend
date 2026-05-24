const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),

    PORT: z.coerce.number().default(3001),

    CLIENT_URL: z.string().url(),

    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional()
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('Invalid environment variables:');
    console.error(parsedEnv.error.flatten().fieldErrors);
    process.exit(1);
}

module.exports = parsedEnv.data;
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
}));

app.use(express.json());

const requiredEnv = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        console.error(`Missing required env variable: ${key}`);
    }
}

console.log('SMTP config check:', {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE,
    user: process.env.SMTP_USER,
    hasPass: Boolean(process.env.SMTP_PASS),
    passStartsWithRe: process.env.SMTP_PASS ? process.env.SMTP_PASS.startsWith('re_') : false,
    mailFrom: process.env.MAIL_FROM,
});

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: {
        user: process.env.SMTP_USER || 'resend',
        pass: process.env.SMTP_PASS,
    },
});

transporter.verify((error) => {
    if (error) {
        console.error('SMTP verification failed:', {
            code: error.code,
            command: error.command,
            responseCode: error.responseCode,
            response: error.response,
            message: error.message,
        });
    } else {
        console.log('Resend SMTP server is ready');
    }
});

app.post('/api/invite', async(req, res) => {
    const { email, workspaceName, inviteLink } = req.body;

    if (!email || !workspaceName || !inviteLink) {
        return res.status(400).json({
            error: 'Missing required fields: email, workspaceName, inviteLink',
        });
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.MAIL_FROM || 'EditorFlow <onboarding@resend.dev>',
            to: email,
            subject: `You have been invited to join ${workspaceName} on EditorFlow`,
            html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You've been invited to EditorFlow!</h2>
          <p>You have been invited to join the workspace <strong>${workspaceName}</strong>.</p>
          <p>Click the link below to accept your invitation and join the workspace.</p>
          <a href="${inviteLink}" style="display: inline-block; padding: 10px 20px; color: white; background-color: #8b5cf6; text-decoration: none; border-radius: 5px; margin-top: 20px;">Join Workspace</a>
        </div>
      `,
        });

        return res.status(200).json({
            success: true,
            messageId: info.messageId,
        });
    } catch (error) {
        console.error('Error sending email:', {
            code: error.code,
            command: error.command,
            responseCode: error.responseCode,
            response: error.response,
            message: error.message,
        });

        return res.status(500).json({
            error: error.response || error.message || 'Failed to send invite email',
        });
    }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`EditorFlow SMTP Mailer running on port ${PORT}`);
});
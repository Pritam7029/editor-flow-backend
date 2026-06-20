const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER || 'resend',
        pass: process.env.SMTP_PASS
    }
});

async function sendWorkspaceInvite({ email, inviteToken, workspaceName, inviterName }) {
    const inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/accept-invite?token=${inviteToken}`;
    
    const mailOptions = {
        from: process.env.MAIL_FROM || 'EditorFlow <no-reply@htsl.in>',
        to: email,
        subject: `You've been invited to join ${workspaceName} on EditorFlow`,
        text: `Hello!\n\n${inviterName} has invited you to join their workspace "${workspaceName}" on EditorFlow.\n\nClick the link below to accept the invitation and get started:\n${inviteUrl}\n\nThis link will expire in 7 days.\n\nBest regards,\nThe EditorFlow Team`,
        html: `
            <div style="font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background-color: #080c14; color: #f1f5f9; padding: 40px 20px; text-align: center;">
                <div style="max-width: 500px; margin: 0 auto; background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 32px; text-align: left; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                    <div style="font-size: 32px; font-weight: bold; background: linear-gradient(135deg, #8b5cf6, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 24px; text-align: center;">
                        ✦ EditorFlow
                    </div>
                    <h2 style="font-size: 20px; font-weight: 700; margin: 0 0 16px; color: #ffffff;">Workspace Invitation</h2>
                    <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px;">
                        Hello! <strong style="color: #ffffff;">${inviterName}</strong> has invited you to join their workspace <strong style="color: #ffffff;">"${workspaceName}"</strong> on EditorFlow.
                    </p>
                    <div style="text-align: center; margin-bottom: 24px;">
                        <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #a78bfa); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 999px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);">
                            Join Workspace
                        </a>
                    </div>
                    <p style="font-size: 13px; color: #64748b; margin: 0; line-height: 1.5; text-align: center;">
                        This invitation link will expire in 7 days.<br>
                        If you did not expect this invitation, you can safely ignore this email.
                    </p>
                    <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 24px 0;">
                    <p style="font-size: 12px; color: #64748b; margin: 0; word-break: break-all; text-align: center;">
                        Or copy and paste this URL into your browser:<br>
                        <a href="${inviteUrl}" style="color: #06b6d4; text-decoration: none;">${inviteUrl}</a>
                    </p>
                </div>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
}

module.exports = {
    sendWorkspaceInvite
};

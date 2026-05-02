require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true, // Use SSL for port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.post('/api/invite', async (req, res) => {
  const { email, workspaceName, inviteLink } = req.body;

  if (!email || !workspaceName || !inviteLink) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const info = await transporter.sendMail({
      from: '"EditorFlow" <onboarding@resend.dev>', // Using Resend's default onboarding email for testing
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

    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: error.response || error.message || 'Failed to send invite email' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`EditorFlow SMTP Mailer running on port ${PORT}`);
});

const nodemailer = require('nodemailer');

const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
const isSecure = process.env.SMTP_PORT
  ? smtpPort === 465
  : process.env.SMTP_SECURE === 'true';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: smtpPort,
  secure: isSecure,
  requireTLS: !isSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

const buildOtpHtml = (otpCode) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
    <h2 style="color: #1C6B77; margin-bottom: 8px;">Dost - The cancer care companion</h2>
    <p style="color: #555; font-size: 15px;">Your verification code is:</p>
    <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1C6B77; padding: 14px 0;">
      ${otpCode}
    </div>
    <p style="color: #7f8c8d; font-size: 13px; margin-top: 10px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
  </div>
`;

const origSendMail = transporter.sendMail.bind(transporter);

transporter.sendMail = async (mailOptions) => {
  const webhookUrl = (process.env.GMAIL_WEBHOOK_URL || '').trim();
  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: mailOptions.to,
        subject: mailOptions.subject || 'Your Dost Login Code',
        text: mailOptions.text || '',
        html: mailOptions.html || buildOtpHtml(mailOptions.otpCode || ''),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === 'error') {
      throw new Error(data.message || `Webhook email failed (${res.status})`);
    }
    return data;
  }
  return origSendMail(mailOptions);
};

transporter.sendOtpEmail = async (toEmail, otpCode, customSubject) => {
  const subject = customSubject || 'Your Dost Login Code';
  const text = `Your Dost verification code is: ${otpCode}\n\nIt will expire in 10 minutes.`;
  const html = buildOtpHtml(otpCode);

  return transporter.sendMail({
    from: `"Dost - The cancer care companion" <${process.env.SMTP_USER || 'ngo.youtube.cse6@gmail.com'}>`,
    to: toEmail,
    subject,
    text,
    html,
    otpCode,
  });
};

module.exports = transporter;
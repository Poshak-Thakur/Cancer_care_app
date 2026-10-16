const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Helper function to send Dost branded verification & OTP emails
const sendOtpEmail = async (toEmail, otpCode, customSubject) => {
    const subject = customSubject || 'Your Dost Login Code';
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #2c3e50; margin-bottom: 8px;">Dost - The cancer care companion</h2>
            <p style="color: #555; font-size: 15px;">Your verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1abc9c; padding: 14px 0;">
                ${otpCode}
            </div>
            <p style="color: #7f8c8d; font-size: 13px; margin-top: 10px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
    `;

    return transporter.sendMail({
        from: `"Dost - The cancer care companion" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject,
        text: `Your Dost verification code is: ${otpCode}\n\nIt will expire in 10 minutes.`,
        html
    });
};

// Export transporter directly for backward compatibility with authController (transporter.sendMail)
// while also attaching sendOtpEmail as a utility method.
transporter.sendOtpEmail = sendOtpEmail;

module.exports = transporter;
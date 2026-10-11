const nodemailer = require('nodemailer');

const port = parseInt(process.env.SMTP_PORT, 10) || 587;

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,   // 465 = implicit TLS, 587 = STARTTLS
    family: 4,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

module.exports = transporter;
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const app = require('./app');
const { initChatCleanupJob } = require('./jobs/chatCleanup');
const { getAllowedOrigins } = require('./config/cors');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Socket.io uses the SAME explicit allowlist as the REST API (CORS_ALLOWED_ORIGINS, see config/cors.js).
// No separate variable and no '*' fallback. Native apps send no Origin header and are unaffected.
const io = new Server(server, {
    cors: {
        origin: getAllowedOrigins(),
        methods: ['GET', 'POST']
    }
});
app.set('io', io);

// Strict JWT authentication for socket handshakes
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error: Token required.'));
    
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error: Invalid or expired token.'));
        socket.userId = decoded.userId;
        next();
    });
});

io.on('connection', (socket) => {
    // Automatically join the authenticated user's private channel
    socket.join(socket.userId);

    socket.on('disconnect', () => {
        // Cleanup handled automatically by Socket.io
    });
});

server.listen(PORT, () => {
    console.log(`Saathi API is running on port ${PORT}`);
    // Start ephemeral message and audio cleanup schedule
    initChatCleanupJob();
});

process.on('unhandledRejection', (err) => {
    console.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
});
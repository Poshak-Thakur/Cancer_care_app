require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, { 
    cors: { 
        origin: process.env.NODE_ENV === 'production' 
            ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['https://ngo.saathi.org']) 
            : '*',
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
});

process.on('unhandledRejection', (err) => {
    console.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
});
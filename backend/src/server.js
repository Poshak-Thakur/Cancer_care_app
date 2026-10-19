require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const app = require('./app');
const { initChatCleanupJob } = require('./jobs/chatCleanup');
const { getAllowedOrigins } = require('./config/cors');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: getAllowedOrigins(),
    methods: ['GET', 'POST'],
  },
});
app.set('io', io);

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
  socket.join(socket.userId);

  socket.on('disconnect', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dost API is running on port ${PORT}`);
  initChatCleanupJob();
});

process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});
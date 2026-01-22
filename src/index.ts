import express from 'express';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { errorHandler } from './middleware/error-handler';

// Routes
import authRoutes from './routes/auth.routes';
import deliveryRoutes from './routes/delivery.routes';
import usersRoutes from './routes/users.routes';
import dashboardRoutes from './routes/dashboard.routes';
import bikesRoutes from './routes/bikes.routes';
import walletRoutes from './routes/wallet.routes';
import postsRoutes from './routes/posts.routes';
import imagesRoutes from './routes/images.routes';

dotenv.config();

const app = express();

// Configurar CORS - precisa ser antes do Server do Socket.io
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
const allowedOrigins = corsOrigin.split(',').map(origin => origin.trim());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"]
  }
});

const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requisições sem origin (mobile apps, Postman, etc)
    if (!origin) return callback(null, true);
    
    // Verificar se a origin está na lista permitida
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Giro Certo API is running' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bikes', bikesRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/images', imagesRoutes);

// Error handler
app.use(errorHandler);

// WebSocket para rastreamento em tempo real
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });

  // Escutar atualizações de localização dos motociclistas
  socket.on('rider:location', (data) => {
    // Broadcast para admin e lojistas
    socket.broadcast.emit('rider:location:update', data);
  });

  // Escutar atualizações de pedidos
  socket.on('delivery:update', (data) => {
    io.emit('delivery:update', data);
  });

  // Escutar atualizações de status de pedido
  socket.on('delivery:status:change', (data) => {
    io.emit('delivery:status:changed', data);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Giro Certo API rodando na porta ${PORT}`);
  console.log(`📡 WebSocket disponível na porta ${PORT}`);
  console.log(`📍 API disponível em http://localhost:${PORT}`);
});

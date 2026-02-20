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
import courierDocumentsRoutes from './routes/courier-documents.routes';
import deliveryRegistrationRoutes from './routes/delivery-registration.routes';
import verificationSelfiesRoutes from './routes/verification-selfies.routes';
import partnersRoutes from './routes/partners.routes';
import disputesRoutes from './routes/disputes.routes';
import reportsRoutes from './routes/reports.routes';
import alertsRoutes from './routes/alerts.routes';

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
app.set('io', io);

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
// Aumentar limites para aceitar payloads grandes (ex: imagens em base64)
app.use(express.json({ limit: process.env.JSON_PAYLOAD_LIMIT || '50mb' }));
app.use(express.urlencoded({ limit: process.env.JSON_PAYLOAD_LIMIT || '50mb', extended: true }));
app.use('/uploads', express.static('uploads'));

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
app.use('/api/courier-documents', courierDocumentsRoutes);
app.use('/api/delivery-registration', deliveryRegistrationRoutes);
app.use('/api/verification-selfies', verificationSelfiesRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/disputes', disputesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/alerts', alertsRoutes);

// Error handler
app.use(errorHandler);

// WebSocket para rastreamento em tempo real
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });

  socket.on('auth', (data: { userId?: string }) => {
    const userId = data?.userId;
    if (userId && typeof userId === 'string') {
      socket.join(`user:${userId}`);
    }
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

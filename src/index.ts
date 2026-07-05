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
import storiesRoutes from './routes/stories.routes';
import chatsRoutes from './routes/chats.routes';
import imagesRoutes from './routes/images.routes';
import courierDocumentsRoutes from './routes/courier-documents.routes';
import deliveryRegistrationRoutes from './routes/delivery-registration.routes';
import verificationSelfiesRoutes from './routes/verification-selfies.routes';
import partnersRoutes from './routes/partners.routes';
import disputesRoutes from './routes/disputes.routes';
import reportsRoutes from './routes/reports.routes';
import alertsRoutes from './routes/alerts.routes';
import socialRoutes from './routes/social.routes';
import communitiesRoutes from './routes/communities.routes';
import mapsRoutes from './routes/maps.routes';
import webhooksRoutes from './routes/webhooks.routes';
import settlementRoutes from './routes/settlement.routes';
import storeRoutes from './routes/store.routes';
import { UserRole } from './types';
import { DeliveryService } from './services/delivery.service';
import {
  canJoinOrderTrackingRoom,
  resolveDeliveryOrderIdByTrackingToken,
  resolveSocketUserFromToken,
} from './utils/socket-events';
import { incrementOpsMetric } from './utils/ops-metrics';
import { persistRiderLocationFromSocketEvent } from './services/rider-location-persist.service';
import { assertProductionEnv } from './utils/startup-env';

dotenv.config();
assertProductionEnv();

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
const deliveryService = new DeliveryService();

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
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/bikes', bikesRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/stories', storiesRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/courier-documents', courierDocumentsRoutes);
app.use('/api/delivery-registration', deliveryRegistrationRoutes);
app.use('/api/verification-selfies', verificationSelfiesRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/disputes', disputesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/communities', communitiesRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/settlement', settlementRoutes);
app.use('/api/store', storeRoutes);

// Error handler
app.use(errorHandler);

// WebSocket para rastreamento em tempo real
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  let socketUserId: string | null = null;
  let socketUserRole: UserRole | null = null;
  let socketPartnerId: string | null = null;

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });

  socket.on('auth', async (data: { userId?: string; token?: string }) => {
    const authHeader = socket.handshake.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;
    const tokenFromClient =
      (typeof data?.token === 'string' && data.token) ||
      (typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : null) ||
      bearerToken;
    const user = await resolveSocketUserFromToken(tokenFromClient);
    if (!user) {
      void incrementOpsMetric('socket_failures_total', 1, 'auth_failed');
      socket.emit('tracking:error', { message: 'Falha de autenticacao no socket' });
      return;
    }
    socketUserId = user.id;
    socketUserRole = user.role;
    socketPartnerId = user.partnerId;
    socket.join(`user:${user.id}`);
    if (user.partnerId) {
      socket.join(`store:${user.partnerId}`);
    }
    if (user.role === UserRole.ADMIN) {
      socket.join('role:admin');
    }
    void deliveryService
      .replayPendingOffersForRider(app, user.id)
      .catch((err) => {
        console.warn('[socket auth] replay pending offers:', err);
      });
  });

  socket.on('tracking:join-order', async (data: { orderId?: string }) => {
    const orderId = data?.orderId;
    if (!orderId || typeof orderId !== 'string') return;
    if (!socketUserId || !socketUserRole) {
      void incrementOpsMetric('socket_failures_total', 1, 'join_order_unauthenticated');
      socket.emit('tracking:error', { message: 'Socket nao autenticado' });
      return;
    }
    const allowed = await canJoinOrderTrackingRoom(
      { id: socketUserId, role: socketUserRole, partnerId: socketPartnerId },
      orderId
    );
    if (!allowed) {
      void incrementOpsMetric('socket_failures_total', 1, 'join_order_forbidden');
      socket.emit('tracking:error', {
        message: 'Sem permissao para acompanhar este pedido',
        orderId,
      });
      return;
    }
    socket.join(`order:${orderId}`);
    socket.emit('tracking:joined', { orderId });
  });

  /**
   * Cliente final (vitrine): entra na sala da entrega só com trackingToken.
   * Sem JWT. Localização do rider só enquanto a entrega está ativa.
   */
  socket.on('tracking:join-by-token', async (data: { trackingToken?: string }) => {
    const trackingToken = data?.trackingToken;
    if (!trackingToken || typeof trackingToken !== 'string') {
      socket.emit('tracking:error', { message: 'Token de acompanhamento inválido' });
      return;
    }
    try {
      const orderId = await resolveDeliveryOrderIdByTrackingToken(trackingToken);
      if (!orderId) {
        void incrementOpsMetric('socket_failures_total', 1, 'join_by_token_forbidden');
        socket.emit('tracking:error', {
          message: 'Pedido sem entrega ativa ou token inválido',
        });
        return;
      }
      socket.join(`order:${orderId}`);
      socket.emit('tracking:joined', { orderId, via: 'token' });
    } catch (err) {
      console.warn('[tracking:join-by-token]', err);
      socket.emit('tracking:error', { message: 'Falha ao entrar no acompanhamento' });
    }
  });

  socket.on('tracking:leave-order', (data: { orderId?: string }) => {
    const orderId = data?.orderId;
    if (orderId && typeof orderId === 'string') {
      socket.leave(`order:${orderId}`);
    }
  });

  // Escutar atualizações de localização dos motociclistas (persistência + broadcast com estrangulamento)
  socket.on('rider:location', (data: any) => {
    if (!socketUserId) return;
    if (data?.userId && data.userId !== socketUserId) {
      void incrementOpsMetric('socket_failures_total', 1, 'location_invalid_user');
      socket.emit('tracking:error', { message: 'userId invalido no payload de localizacao' });
      return;
    }
    const orderId =
      data && typeof data.orderId === 'string' && data.orderId.trim().length > 0
        ? data.orderId.trim()
        : null;
    const latRaw = data?.lat;
    const lngRaw = data?.lng;
    const lat = typeof latRaw === 'number' ? latRaw : parseFloat(String(latRaw ?? ''));
    const lng = typeof lngRaw === 'number' ? lngRaw : parseFloat(String(lngRaw ?? ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    void persistRiderLocationFromSocketEvent(app, {
      userId: socketUserId,
      latitude: lat,
      longitude: lng,
      orderId,
      status: typeof data?.status === 'string' ? data.status : null,
      forceImmediate: data?.checkpoint === true,
    }).catch((err) => {
      console.warn('[rider:location] persist:', err);
    });
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

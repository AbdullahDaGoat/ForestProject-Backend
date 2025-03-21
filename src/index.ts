import express from 'express';
import cors from 'cors';
import path from 'path';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// Our routes
import inputDataRoutes from './routes/inputData';
import notificationRoutes from './routes/notifications';

// Initialize express
const app = express();
const httpServer = createServer(app);

// If you need websockets, you can set up Socket.io here:
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Basic express setup
app.use(cors());
app.use(bodyParser.json());

// SSE, normal GET/POST for environmental data
app.use('/inputData', inputDataRoutes);

// Push notification endpoints
app.use('/save-subscription', notificationRoutes.saveSubscription);
app.use('/trigger-notification', notificationRoutes.triggerNotification);

// Example: you can serve public static files if needed (like .json data)
app.use('/public', express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});

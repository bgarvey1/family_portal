const express = require('express');
const config = require('./config');
const corsMiddleware = require('./middleware/cors');
const healthRoutes = require('./routes/health');
const syncRoutes = require('./routes/sync');
const manifestRoutes = require('./routes/manifests');
const fileRoutes = require('./routes/files');

const app = express();

app.use(express.json());
app.use(corsMiddleware);

app.use('/api', healthRoutes);
app.use('/api', syncRoutes);
app.use('/api', manifestRoutes);
app.use('/api', fileRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`familyhub-backend listening on port ${config.port} (${config.nodeEnv})`);
});

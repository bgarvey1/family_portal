require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  gcpProjectId: process.env.GCP_PROJECT_ID,
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  driveFolderId: process.env.DRIVE_FOLDER_ID,
  pollIntervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES, 10) || 15,
  apiKey: process.env.API_KEY,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
};

const required = ['anthropicApiKey', 'gcpProjectId', 'driveFolderId', 'apiKey'];
for (const key of required) {
  if (!config[key]) {
    console.error(`Missing required env var for config.${key}`);
    process.exit(1);
  }
}

module.exports = config;

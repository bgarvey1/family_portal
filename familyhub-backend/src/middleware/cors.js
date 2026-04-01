const cors = require('cors');

// Allow all origins — the x-api-key header provides authentication.
// This is necessary because Claude Artifacts run in sandboxed iframes
// whose origin varies and can't be predicted.
const corsOptions = {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
};

module.exports = cors(corsOptions);

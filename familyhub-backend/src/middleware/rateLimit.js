// Simple in-memory rate limiter — no external dependencies needed.
// Uses a sliding window per IP address.

function createRateLimiter({ windowMs = 60_000, max = 10, message = 'Too many requests, please try again later.' } = {}) {
  const hits = new Map(); // ip → [timestamps]

  // Clean up stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of hits) {
      const valid = times.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, valid);
      }
    }
  }, 5 * 60_000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const times = (hits.get(ip) || []).filter(t => now - t < windowMs);

    if (times.length >= max) {
      return res.status(429).json({ error: message });
    }

    times.push(now);
    hits.set(ip, times);
    next();
  };
}

module.exports = { createRateLimiter };

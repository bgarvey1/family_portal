const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const config = require('../config');

// Chat hits Claude API — limit to 20 requests per minute per IP
const chatLimiter = createRateLimiter({ windowMs: 60_000, max: 20, message: 'Too many chat requests. Please wait a moment and try again.' });

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// POST /api/chat — proxy Claude messages API
// Body: { messages: [...], system: "..." }
router.post('/chat', requireApiKey, chatLimiter, async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: system || undefined,
      messages,
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    res.json({ text });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(502).json({ error: 'Failed to get response from Claude' });
  }
});

module.exports = router;

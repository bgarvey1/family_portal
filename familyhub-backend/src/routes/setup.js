const { Router } = require('express');
const path = require('path');

const router = Router();

// Serve the signed shortcut file
router.get('/setup/shortcut', (req, res) => {
  const file = path.join(__dirname, '..', 'static', 'Send_to_FamilyHub.shortcut');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename="Send_to_FamilyHub.shortcut"');
  res.sendFile(file);
});

// Setup page — one-tap install for family members
router.get('/setup', (req, res) => {
  // Cloud Run is behind a proxy, so use x-forwarded-proto for the real protocol
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const baseUrl = `${proto}://${req.get('host')}`;
  const shortcutUrl = `${baseUrl}/api/setup/shortcut`;
  // Direct download — iOS opens .shortcut files in the Shortcuts app automatically
  const installUrl = shortcutUrl;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FamilyHub Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #FDF8F0;
      color: #2A1A06;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
    }
    .card {
      background: white;
      border-radius: 20px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(74,46,14,0.1);
      text-align: center;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      color: #4A2E0E;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 16px;
      color: #7A5535;
      margin-bottom: 32px;
      line-height: 1.5;
    }
    .install-btn {
      display: block;
      width: 100%;
      padding: 18px 24px;
      border-radius: 14px;
      border: none;
      background: #B8760A;
      color: white;
      font-size: 20px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      margin-bottom: 16px;
      transition: transform 0.1s;
    }
    .install-btn:active { transform: scale(0.97); }
    .step {
      text-align: left;
      padding: 16px;
      background: #F7EDD5;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .step-num {
      display: inline-block;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #B8760A;
      color: white;
      text-align: center;
      line-height: 28px;
      font-weight: 700;
      font-size: 14px;
      margin-right: 10px;
    }
    .step-text { font-size: 15px; line-height: 1.5; }
    .note {
      font-size: 13px;
      color: #A0845C;
      margin-top: 20px;
      line-height: 1.5;
    }
    .webapp-section {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #E8D5A8;
    }
    .alt-btn {
      display: block;
      width: 100%;
      padding: 14px 24px;
      border-radius: 14px;
      border: 2px solid #E8D5A8;
      background: white;
      color: #7A5535;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 48px; margin-bottom: 12px;">&#x1F46A;</div>
    <h1>FamilyHub Setup</h1>
    <p class="subtitle">Add photos from your phone's camera roll directly to the family vault.</p>

    <a href="${installUrl}" class="install-btn">
      Install "Send to FamilyHub"
    </a>

    <div class="step">
      <span class="step-num">1</span>
      <span class="step-text">Tap the button above to install the shortcut</span>
    </div>
    <div class="step">
      <span class="step-num">2</span>
      <span class="step-text">Open <strong>Photos</strong>, pick a photo, tap <strong>Share</strong></span>
    </div>
    <div class="step">
      <span class="step-num">3</span>
      <span class="step-text">Scroll down and tap <strong>"Send to FamilyHub"</strong></span>
    </div>

    <p class="note">
      Photos upload with full quality and metadata (date, location, camera info).
      They're automatically classified by AI and appear in the family vault.
    </p>

    <div class="webapp-section">
      <p style="font-size: 14px; color: #7A5535; margin-bottom: 12px;">
        Or just use the web app directly:
      </p>
      <a href="${baseUrl}" class="alt-btn">
        Open FamilyHub
      </a>
    </div>
  </div>
</body>
</html>`);
});

module.exports = router;

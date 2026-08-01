import { Router } from 'express';
import { requireString, rejectUnknownKeys } from '../lib/validate.js';
import { converseOnChannel } from '../lib/channels.js';

const router = Router();

// Is the coach reachable from outside the web app, and which channels are live?
router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    telegram_enabled: !!process.env.HELM_COACH_BOT_TOKEN,
    channels: ['web', 'cli', 'telegram'],
  });
});

// Generic inbound endpoint. Any channel adapter (the CLI, or a webhook for
// WhatsApp / Slack / email) POSTs here and gets the coach's reply back.
// Protected by the dashboard bearer token like every other /api route.
router.post('/message', async (req, res, next) => {
  try {
    rejectUnknownKeys(req.body || {}, ['channel', 'ref', 'text', 'sender', 'model']);
    const channel = requireString(req.body, 'channel');
    const ref = requireString(req.body, 'ref');
    const text = requireString(req.body, 'text');
    const sender = typeof req.body?.sender === 'string' ? req.body.sender : null;
    const model = typeof req.body?.model === 'string' ? req.body.model : undefined;
    const { conversationId, reply } = await converseOnChannel({
      channel, channelRef: ref, senderName: sender, text, model,
    });
    res.json({ conversation_id: conversationId, reply });
  } catch (e) { next(e); }
});

export default router;

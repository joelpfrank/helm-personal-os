import { Router } from 'express';
import { errors } from '../lib/errors.js';
import { sendTelegram, notifyEnabled } from '../lib/notify.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({ enabled: notifyEnabled() });
});

router.post('/', async (req, res, next) => {
  try {
    const text = (req.body?.text ?? '').toString();
    if (!text.trim()) throw errors.validation('text required');
    const sent = await sendTelegram(text);
    res.json({ sent, enabled: notifyEnabled() });
  } catch (e) { next(e); }
});

export default router;

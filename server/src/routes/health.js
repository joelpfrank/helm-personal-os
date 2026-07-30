import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ ok: true, service: 'helm-personal-os', version: '0.1.1' });
});

export default router;

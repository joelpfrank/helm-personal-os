import { Router } from 'express';
import { errors } from '../lib/errors.js';
import { rejectUnknownKeys } from '../lib/validate.js';
import {
  getWorkoutRestTimer,
  startWorkoutRestTimer,
  stopWorkoutRestTimer,
} from '../lib/workout-rest-timer.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getWorkoutRestTimer());
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body || {};
    rejectUnknownKeys(body, ['duration_seconds', 'first_interval_seconds', 'repeat_enabled', 'notifications_enabled']);
    const durationSeconds = body.duration_seconds;
    if (!Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 3600) {
      throw errors.validation('duration_seconds must be an integer between 15 and 3600');
    }
    const firstIntervalSeconds = body.first_interval_seconds ?? durationSeconds;
    if (!Number.isInteger(firstIntervalSeconds) || firstIntervalSeconds < 1 || firstIntervalSeconds > 3600) {
      throw errors.validation('first_interval_seconds must be an integer between 1 and 3600');
    }
    if (body.repeat_enabled != null && typeof body.repeat_enabled !== 'boolean') {
      throw errors.validation('repeat_enabled must be a boolean');
    }
    if (body.notifications_enabled != null && typeof body.notifications_enabled !== 'boolean') {
      throw errors.validation('notifications_enabled must be a boolean');
    }
    res.json(startWorkoutRestTimer({
      durationSeconds,
      firstIntervalSeconds,
      repeatEnabled: body.repeat_enabled === true,
      notificationsEnabled: body.notifications_enabled !== false,
    }));
  } catch (error) { next(error); }
});

router.delete('/', (_req, res) => {
  stopWorkoutRestTimer();
  res.status(204).end();
});

export default router;

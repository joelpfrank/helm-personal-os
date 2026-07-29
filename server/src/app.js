import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { requireAuth } from './auth.js';
import { errorHandler } from './lib/errors.js';
import { createApiLimiter, createAuthLimiter } from './lib/rate-limit.js';
import healthRouter from './routes/health.js';
import boardsRouter from './routes/boards.js';
import { boardColumnsRouter, columnsRouter } from './routes/columns.js';
import { columnCardsRouter, cardsRouter } from './routes/cards.js';
import tagsRouter from './routes/tags.js';
import habitsRouter from './routes/habits.js';
import exercisesRouter from './routes/exercises.js';
import routinesRouter from './routes/routines.js';
import workoutRestTimerRouter from './routes/workout-rest-timer.js';
import workoutsRouter from './routes/workouts.js';
import calendarRouter from './routes/calendar.js';
import chatRouter from './routes/chat.js';
import memoriesRouter from './routes/memories.js';
import foodRouter from './routes/food.js';
import coachRouter from './routes/coach.js';
import modulesRouter from './routes/modules.js';
import moduleTemplatesRouter from './routes/module-templates.js';
import mcpServersRouter from './routes/mcp-servers.js';
import agentsRouter from './routes/agents.js';
import notifyRouter from './routes/notify.js';
import channelsRouter from './routes/channels.js';
import authRouter from './routes/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Never trust forwarded IP headers — req.ip must be the real socket peer,
  // otherwise a caller could spoof X-Forwarded-For to get a fresh rate-limit
  // bucket per request.
  app.set('trust proxy', false);
  app.use(express.json({ limit: '1mb' }));

  // Global limiter runs before any route dispatch, so it covers every
  // mutating API route and the SPA fallback below (CodeQL js/missing-rate-limiting).
  app.use(createApiLimiter());
  // Tighter, longer-window budget layered on top for the auth endpoints,
  // to slow credential/token guessing.
  app.use('/api/auth', createAuthLimiter());

  app.use(requireAuth);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/boards/:boardId/columns', boardColumnsRouter);
  app.use('/api/boards', boardsRouter);
  app.use('/api/columns/:columnId/cards', columnCardsRouter);
  app.use('/api/columns', columnsRouter);
  app.use('/api/cards', cardsRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/habits', habitsRouter);
  app.use('/api/exercises', exercisesRouter);
  app.use('/api/routines', routinesRouter);
  app.use('/api/workouts/rest-timer', workoutRestTimerRouter);
  app.use('/api/workouts', workoutsRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/memories', memoriesRouter);
  app.use('/api/food', foodRouter);
  app.use('/api/coach', coachRouter);
  app.use('/api/modules', modulesRouter);
  app.use('/api/module-templates', moduleTemplatesRouter);
  app.use('/api/mcp-servers', mcpServersRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/notify', notifyRouter);
  app.use('/api/channels', channelsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'no such endpoint' } });
  });

  const distDir = path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(distDir)) {
    // Optional per-instance icon flavor. DASHBOARD_FLAVOR=girly swaps in the
    // pink icon set without rebuilding the SPA.
    const FLAVOR = process.env.DASHBOARD_FLAVOR === 'girly' ? 'girly' : 'default';
    const PINK_REWRITES = {
      '/favicon.svg':             '/favicon-pink.svg',
      '/apple-touch-icon.png':    '/apple-touch-icon-pink.png',
      '/apple-touch-icon-152.png':'/apple-touch-icon-pink-152.png',
      '/apple-touch-icon-167.png':'/apple-touch-icon-pink-167.png',
      '/icon-192.png':            '/icon-pink-192.png',
      '/icon-256.png':            '/icon-pink-256.png',
      '/icon-384.png':            '/icon-pink-384.png',
      '/icon-512.png':            '/icon-pink-512.png',
      '/icon-maskable-512.png':   '/icon-maskable-pink-512.png',
    };
    if (FLAVOR === 'girly') {
      app.use((req, _res, next) => {
        const mapped = PINK_REWRITES[req.path];
        if (mapped) req.url = mapped + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
        next();
      });
    }

    // Override the static manifest with a dynamic one that bakes the
    // dashboard token into start_url. Safari uses start_url as the
    // launch URL for installed PWAs, and the PWA's localStorage is
    // isolated from the regular browser tab — so the token has to
    // travel via the URL on every launch.
    app.get('/manifest.webmanifest', (_req, res) => {
      const pink = FLAVOR === 'girly';
      res.json({
        name: 'Helm Personal OS',
        short_name: 'Helm',
        description: 'Your vision, goals, habits, and days in one place — AI-operable.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#14161b',
        background_color: '#14161b',
        icons: [
          { src: pink ? '/icon-pink-192.png'          : '/icon-192.png',          sizes: '192x192', type: 'image/png' },
          { src: pink ? '/icon-pink-256.png'          : '/icon-256.png',          sizes: '256x256', type: 'image/png' },
          { src: pink ? '/icon-pink-384.png'          : '/icon-384.png',          sizes: '384x384', type: 'image/png' },
          { src: pink ? '/icon-pink-512.png'          : '/icon-512.png',          sizes: '512x512', type: 'image/png' },
          { src: pink ? '/icon-maskable-pink-512.png' : '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: pink ? '/favicon-pink.svg'           : '/favicon.svg',           sizes: 'any',     type: 'image/svg+xml' },
        ],
      });
    });

    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

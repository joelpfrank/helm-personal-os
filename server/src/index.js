import http from 'node:http';
import { createApp } from './app.js';
import { runMigrations } from './db.js';
import { getToken, tokenPath } from './auth.js';
import { syncCalendar } from './lib/calendar-sync.js';
import { startScheduler } from './routes/agents.js';
import { startTelegramCoach } from './lib/channel-telegram.js';
import { startWorkoutRestTimerScheduler } from './lib/workout-rest-timer.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

runMigrations();
getToken();

const app = createApp();
const hosts = [HOST];

const servers = hosts.map((host) => {
  const server = http.createServer(app);
  server.listen(PORT, host, () => {
    console.log(`[startup] Helm Personal OS listening on http://${host}:${PORT}`);
  });
  server.on('error', (err) => {
    console.error(`[startup] failed to bind ${host}:${PORT} —`, err.message);
  });
  return server;
});

console.log(`[startup] token file: ${tokenPath()}`);

// Background Google Calendar sync — every 5 minutes when authorized.
// Skips quietly if unconfigured. First run kicks off 10s after boot to
// avoid contending with startup.
const SYNC_INTERVAL_MS = Number(process.env.CALENDAR_SYNC_MS || 5 * 60 * 1000);
setTimeout(function tick() {
  syncCalendar()
    .then((r) => { if (r && !r.skipped) console.log('[calendar] sync', r); })
    .catch((err) => console.error('[calendar] sync error:', err.message))
    .finally(() => setTimeout(tick, SYNC_INTERVAL_MS).unref());
}, 10_000).unref();

// Agents & automations — fire scheduled agents on their cadence (60s tick).
try { startScheduler(); } catch (err) { console.error('[agents] scheduler failed to start:', err.message); }

// Persisted workout rest timer — resumes after a service restart.
try { startWorkoutRestTimerScheduler(); } catch (err) { console.error('[workouts] rest timer failed to start:', err.message); }

// Helm coach over Telegram — dormant unless HELM_COACH_BOT_TOKEN is set.
try { startTelegramCoach(); } catch (err) { console.error('[channels] telegram coach failed to start:', err.message); }

function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing ${servers.length} listener(s)`);
  let remaining = servers.length;
  const done = () => { if (--remaining <= 0) process.exit(0); };
  for (const s of servers) s.close(done);
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

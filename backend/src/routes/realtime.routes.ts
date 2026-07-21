import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { config } from '../config';

const router = Router();

/** Server-sent events — periodic tick so clients refresh live data without manual reload. */
router.get('/events', authenticate, (req: AuthRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const send = (type: string) => {
    res.write(`data: ${JSON.stringify({ type, at: new Date().toISOString() })}\n\n`);
  };

  send('connected');

  const intervalMs = config.nodeEnv === 'production' ? 15_000 : 12_000;
  const heartbeat = setInterval(() => send('tick'), intervalMs);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

export default router;

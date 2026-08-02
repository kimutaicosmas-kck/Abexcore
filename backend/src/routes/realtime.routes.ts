import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { config } from '../config';

const router = Router();

/** Server-sent events — periodic tick so clients refresh live data without manual reload. */
router.get('/events', authenticate, (req: AuthRequest, res: Response) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // Discourage intermediaries from buffering / HTTP/2 quirks on idle streams
  res.setHeader('Content-Encoding', 'identity');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const write = (chunk: string) => {
    res.write(chunk);
    const flushable = res as Response & { flush?: () => void };
    if (typeof flushable.flush === 'function') flushable.flush();
  };

  const send = (type: string) => {
    write(`data: ${JSON.stringify({ type, at: new Date().toISOString() })}\n\n`);
  };

  // Comment frame forces proxies to flush headers immediately
  write(': connected\n\n');
  send('connected');

  const tickMs = config.nodeEnv === 'production' ? 15_000 : 12_000;
  const pingMs = 10_000;
  const heartbeat = setInterval(() => send('tick'), tickMs);
  const keepalive = setInterval(() => write(': ping\n\n'), pingMs);

  const cleanup = () => {
    clearInterval(heartbeat);
    clearInterval(keepalive);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

export default router;

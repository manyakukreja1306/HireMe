import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = ({ timestamp, method, path, body, encodedContext }) =>
  `${timestamp}\n${String(method).toUpperCase()}\n${path}\n${digest(body)}\n${encodedContext}`;

export function signGatewayContext(secret, { timestamp, method, path, body, context }) {
  const encodedContext = Buffer.from(JSON.stringify(context)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(canonical({ timestamp, method, path, body, encodedContext }))
    .digest('base64url');
  return { encodedContext, signature, assertion: `${timestamp}.${encodedContext}.${signature}` };
}

export function verifyGatewayContext({ secret, timestamp, method, path, body, encodedContext, signature, tokenSubject, now = Date.now() }) {
  if (!secret || secret.length < 32 || typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp)) return null;
  if (Math.abs(now - Number(timestamp)) > 60_000) return null;
  if (typeof encodedContext !== 'string' || encodedContext.length > 4096 || typeof signature !== 'string') return null;
  const expected = createHmac('sha256', secret)
    .update(canonical({ timestamp, method, path, body, encodedContext }))
    .digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let context;
  try { context = JSON.parse(Buffer.from(encodedContext, 'base64url').toString('utf8')); } catch { return null; }
  if (!context || context.sub !== tokenSubject || !['candidate', 'recruiter'].includes(context.role)) return null;
  for (const key of ['applicationId', 'candidateId', 'employerId', 'jobId']) {
    if (typeof context[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(context[key])) return null;
  }
  return context;
}

export function canAccessPipeline(context, record) {
  if (!context || !record || context.applicationId !== record.applicationId || context.jobId !== record.jobId) return false;
  if (context.role === 'candidate') return context.sub === record.candidateId && context.candidateId === record.candidateId;
  if (context.role === 'recruiter') return context.sub === record.employerId && context.employerId === record.employerId;
  return false;
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
    res.json({
        status: 'ok',
        serpApiConfigured: !!process.env.SERPAPI_KEY,
        geminiConfigured: !!process.env.GEMINI_API_KEY,
        timestamp: new Date().toISOString(),
    });
}

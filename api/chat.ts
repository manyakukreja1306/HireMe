import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const secretKey = process.env.CLERK_SECRET_KEY;
        const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
        if (!secretKey || !bearer) return res.status(401).json({ error: 'Authentication required' });
        const parties = (process.env.CLERK_AUTHORIZED_PARTIES || '').split(',').map(value => value.trim()).filter(Boolean);
        let claims;
        try { claims = await verifyToken(bearer, { secretKey, ...(parties.length ? { authorizedParties: parties } : {}) }); }
        catch { return res.status(401).json({ error: 'Authentication required' }); }
        if (typeof claims.sub !== 'string') return res.status(401).json({ error: 'Authentication required' });
        const { message } = req.body;
        if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.json({
                reply: "I am currently in setup mode! Please ask your administrator to add the `GEMINI_API_KEY` to the environment variables so my neural nets can come online. 🤖"
            });
        }

        // Use Gemini REST API directly (no SDK needed for serverless)
        const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEMINI_API_KEY}`;

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `You are Hirely AI, a highly professional, helpful, and concise recruiter assistant for an innovative job portal named Hirely. Keep your answers short (1-3 sentences) and friendly. User says: ${message}`
                    }]
                }]
            })
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API error:', errorText);
            return res.status(500).json({ error: 'AI service error' });
        }

        const data = await geminiResponse.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I didn't quite catch that.";

        res.json({ reply });
    } catch (error: any) {
        console.error('Error in AI Chatbot:', error.message);
        res.status(500).json({ error: 'Failed to process chat message' });
    }
}

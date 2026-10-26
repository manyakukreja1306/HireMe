import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.json({
                reply: "I am currently in setup mode! Please ask your administrator to add the `GEMINI_API_KEY` to the environment variables so my neural nets can come online. 🤖"
            });
        }

        // Use Gemini REST API directly (no SDK needed for serverless)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

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

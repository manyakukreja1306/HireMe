import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3001;

const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!SERPAPI_KEY) {
    console.error('❌ SERPAPI_KEY is missing from .env file');
    process.exit(1);
}

// CORS middleware for development
app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Supabase Connection ---
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('⚠️  Supabase environment variables are missing. DB features will be limited.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// --- Supabase-backed Endpoints ---

// JOBS
app.get('/api/db/jobs', async (_req, res) => {
    try {
        const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        // Map snake_case (DB) to CamelCase (Frontend)
        const jobs = (data || []).map(db => ({
            id: db.id,
            title: db.title,
            company: db.company,
            location: db.location,
            type: db.type,
            salary: db.salary,
            category: db.category,
            description: db.description,
            requiredSkills: db.required_skills || [],
            preferredSkills: db.preferred_skills || [],
            employerId: db.employer_id,
            postedAt: db.posted_at,
            logo: db.logo,
            documentUrl: db.document_url,
            isExternal: false
        }));
        res.json(jobs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/db/jobs', async (req, res) => {
    try {
        const job = req.body;
        // Map CamelCase (Frontend) to snake_case (DB)
        const dbJob = {
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            type: job.type,
            salary: job.salary,
            category: job.category,
            description: job.description,
            required_skills: Array.isArray(job.requiredSkills) ? job.requiredSkills : [],
            preferred_skills: Array.isArray(job.preferredSkills) ? job.preferredSkills : [],
            employer_id: job.employerId,
            posted_at: job.postedAt,
            logo: job.logo,
            document_url: job.documentUrl
        };
        const { error } = await supabase.from('jobs').upsert(dbJob);
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/db/jobs/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('jobs').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// APPLICATIONS
app.get('/api/db/applications', async (_req, res) => {
    try {
        const { data, error } = await supabase.from('applications').select('*').order('applied_at', { ascending: false });
        if (error) throw error;
        // Map snake_case (DB) to CamelCase (Frontend)
        const apps = (data || []).map(db => ({
            id: db.id,
            jobId: db.job_id,
            employerId: db.employer_id,
            candidateId: db.candidate_id,
            candidateName: db.candidate_name,
            candidateEmail: db.candidate_email,
            appliedAt: Number(db.applied_at),
            status: db.status,
        }));
        res.json(apps);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/db/applications', async (req, res) => {
    try {
        const app = req.body;
        // Map CamelCase (Frontend) to snake_case (DB)
        const dbApp = {
            id: app.id,
            job_id: app.jobId,
            employer_id: app.employerId,
            candidate_id: app.candidateId,
            candidate_name: app.candidateName,
            candidate_email: app.candidateEmail,
            applied_at: app.appliedAt,
            status: app.status,
            resume_url: ''
        };
        const { error } = await supabase.from('applications').upsert(dbApp);
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.put('/api/db/applications/:id', async (req, res) => {
    try {
        const update: any = {};
        if (req.body.status) update.status = req.body.status;
        // Resume files are stored in private S3 by the assessment upload flow.

        const { error } = await supabase.from('applications').update(update).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PROFILES
app.get('/api/db/profiles', async (_req, res) => {
    try {
        const { data, error } = await supabase.from('profiles').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/db/profiles/:uid', async (req, res) => {
    try {
        const { data, error } = await supabase.from('profiles').select('*').eq('uid', req.params.uid).maybeSingle();
        if (error) throw error;
        res.json(data || null);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/db/profiles', async (req, res) => {
    try {
        const { error } = await supabase.from('profiles').upsert(req.body);
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// MESSAGES
app.get('/api/db/messages/:appId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('application_id', req.params.appId)
            .order('timestamp', { ascending: true });
        if (error) throw error;
        // Map snake_case to CamelCase
        const msgs = (data || []).map(db => ({
            id: db.id,
            applicationId: db.application_id,
            senderId: db.sender_id,
            text: db.content,
            timestamp: Number(db.timestamp),
            isAi: db.is_ai,
            isVideoCallRequest: db.is_video_call_request,
            videoCallStatus: db.video_call_status,
            videoCallUrl: db.video_call_url
        }));
        res.json(msgs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/db/messages/:appId', async (req, res) => {
    try {
        const msg = req.body;
        const { error } = await supabase.from('messages').insert({
            id: msg.id,
            application_id: req.params.appId,
            sender_id: msg.senderId,
            content: msg.text,
            timestamp: msg.timestamp,
            is_ai: msg.isAi || false,
            is_video_call_request: msg.isVideoCallRequest || false,
            video_call_status: msg.videoCallStatus || null,
            video_call_url: msg.videoCallUrl || null
        });
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});


app.put('/api/db/messages/:appId/:msgId', async (req, res) => {
    try {
        const update: any = {};
        if (req.body.text) update.content = req.body.text;
        if (req.body.isAi !== undefined) update.is_ai = req.body.isAi;
        if (req.body.videoCallStatus) update.video_call_status = req.body.videoCallStatus;
        if (req.body.videoCallUrl) update.video_call_url = req.body.videoCallUrl;

        const { error } = await supabase
            .from('messages')
            .update(update)
            .eq('id', req.params.msgId);
        if (error) throw error;
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});


// --- Google Jobs via SerpApi ---
app.get('/api/jobs/search', async (req, res) => {
    try {
        const query = (req.query.q as string) || 'Software Developer';
        const location = (req.query.location as string) || 'India';
        const maxPages = Math.min(parseInt(req.query.pages as string) || 1, 3);

        const allJobs: any[] = [];
        let nextPageToken: string | null = null;

        for (let page = 0; page < maxPages; page++) {
            const params = new URLSearchParams({
                engine: 'google_jobs',
                q: query,
                location: location,
                hl: 'en',
                tbs: 'qdr:w',
                api_key: SERPAPI_KEY,
            });

            if (nextPageToken) {
                params.set('next_page_token', nextPageToken);
            }

            const serpResponse = await fetch(`https://serpapi.com/search.json?${params.toString()}`);

            if (!serpResponse.ok) {
                const errorText = await serpResponse.text();
                console.error(`SerpApi error (page ${page + 1}):`, errorText);
                break;
            }

            const data = await serpResponse.json();
            const jobResults = data.jobs_results || [];

            for (const job of jobResults) {
                let applyUrl = job.share_link || '';
                if (job.apply_options && job.apply_options.length > 0) {
                    applyUrl = job.apply_options[0].link || applyUrl;
                }
                let source = 'Google Jobs';
                if (job.via) source = job.via.replace('via ', '');

                allJobs.push({
                    id: `serp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    title: job.title || 'Untitled',
                    company: job.company_name || 'Unknown Company',
                    location: job.location || location,
                    type: detectJobType(job),
                    salary: extractSalary(job),
                    category: detectCategory(job.title || ''),
                    postedAt: job.detected_extensions?.posted_at || 'Recently',
                    description: job.description || 'No description available.',
                    logo: job.thumbnail || `https://ui-avatars.com/api/?name=${encodeURIComponent(job.company_name || 'C')}&background=6366f1&color=fff&size=100`,
                    isExternal: true,
                    externalUrl: applyUrl,
                    externalSource: source,
                });
            }

            nextPageToken = data.serpapi_pagination?.next_page_token || null;
            if (!nextPageToken) break;
        }

        console.log(`✅ Fetched ${allJobs.length} jobs for "${query}" in "${location}"`);

        res.json({
            success: true,
            count: allJobs.length,
            query,
            location,
            jobs: allJobs,
        });
    } catch (error: any) {
        console.error('❌ Error fetching jobs from SerpApi:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch jobs', message: error.message });
    }
});

// --- Adzuna Jobs API (India) ---
app.get('/api/jobs/adzuna', async (req, res) => {
    try {
        const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
        const ADZUNA_API_KEY = process.env.ADZUNA_API_KEY;

        if (!ADZUNA_APP_ID || !ADZUNA_API_KEY) {
            return res.status(500).json({ success: false, error: 'Adzuna API credentials not configured' });
        }

        const query = (req.query.q as string) || 'software developer';
        const page = parseInt(req.query.page as string) || 1;
        const resultsPerPage = parseInt(req.query.results_per_page as string) || 20;

        const params = new URLSearchParams({
            app_id: ADZUNA_APP_ID,
            app_key: ADZUNA_API_KEY,
            results_per_page: String(resultsPerPage),
            what: query,
            sort_by: 'date',
        });

        const location = (req.query.location as string) || '';
        if (location) params.set('where', location);

        const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/in/search/${page}?${params.toString()}`;
        console.log(`🔍 Adzuna: Fetching "${query}" page ${page}...`);

        const response = await fetch(adzunaUrl);

        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ Adzuna API error:', errText);
            return res.status(response.status).json({ success: false, error: 'Adzuna API request failed', details: errText });
        }

        const data = await response.json();
        const results = data.results || [];

        const jobs = results.map((job: any) => ({
            id: `adzuna_${job.id || Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            title: job.title || 'Untitled',
            company: job.company?.display_name || 'Unknown Company',
            location: job.location?.display_name || 'India',
            type: detectJobTypeFromTitle(job.title || ''),
            salary: job.salary_min && job.salary_max
                ? `₹${Math.round(job.salary_min).toLocaleString('en-IN')} - ₹${Math.round(job.salary_max).toLocaleString('en-IN')}`
                : job.salary_min ? `₹${Math.round(job.salary_min).toLocaleString('en-IN')}+`
                    : 'Not specified',
            category: mapAdzunaCategory(job.category?.label || '', job.title || ''),
            postedAt: job.created ? new Date(job.created).toLocaleDateString() : 'Recently',
            description: job.description || 'No description available.',
            logo: `https://ui-avatars.com/api/?name=${encodeURIComponent(job.company?.display_name || 'C')}&background=6366f1&color=fff&size=100`,
            isExternal: true,
            externalUrl: job.redirect_url || '',
            externalSource: 'Adzuna',
        }));

        console.log(`✅ Adzuna: Retrieved ${jobs.length} jobs for "${query}"`);

        res.json({ success: true, count: jobs.length, total: data.count || 0, query, jobs });
    } catch (error: any) {
        console.error('❌ Adzuna fetch error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch from Adzuna', message: error.message });
    }
});

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', serpApiConfigured: !!SERPAPI_KEY, supabaseConfigured: !!SUPABASE_URL });
});

// --- AI Chatbot ---
import { GoogleGenAI } from '@google/genai';

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.json({ reply: "I am currently in setup mode! Please add the `GEMINI_API_KEY` to the `.env` file. 🤖" });
        }

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `You are Hirely AI, a highly professional, helpful, and concise recruiter assistant for an innovative job portal named Hirely. Keep your answers short (1-3 sentences) and friendly. 
            User says: ${message}`
        });

        res.json({ reply: response.text });
    } catch (error: any) {
        console.error('❌ Error in AI Chatbot:', error.message);
        res.status(500).json({ error: 'Failed to process chat message' });
    }
});

// --- AI Voice Chat (Interview Coach) ---
app.post('/api/voice-chat', async (req, res) => {
    try {
        const { message, mode, history } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            return res.json({ reply: "Voice AI is not configured." });
        }

        const modePrompts: Record<string, string> = {
            'hr': 'You conduct HR-style interview questions: motivation, teamwork, salary expectations, career goals, company culture fit, strengths and weaknesses.',
            'technical': 'You ask technical interview questions relevant to software engineering: data structures, algorithms, system design, coding patterns, debugging, and technology-specific questions.',
            'behavioral': 'You ask behavioral/situational interview questions using the STAR method: "Tell me about a time when...", conflict resolution, leadership, problem-solving under pressure.',
            'resume': 'You analyze and discuss resume-related topics: gaps in experience, project explanations, skill relevance, how to improve their resume, and career trajectory.',
        };

        const modeInstruction = modePrompts[mode] || modePrompts['technical'];
        const conversationContext = (history || [])
            .map((m: any) => `${m.role === 'ai' ? 'Interviewer' : 'Candidate'}: ${m.text}`)
            .join('\n');

        const systemPrompt = `You are Hirely AI, a professional and realistic job interview coach.
You are conducting a live voice mock interview. ${modeInstruction}
Rules:
- Keep responses conversational, concise (2-4 sentences max), and suitable for text-to-speech.
- Ask ONE clear follow-up question at the end of each response.
- Be encouraging but honest. Give brief feedback on the answer before asking the next question.
- Do NOT use markdown, bullet points, or special formatting. Speak naturally.
- If this is the start of the conversation, introduce yourself briefly and ask the first question.

${conversationContext ? `Conversation so far:\n${conversationContext}\n` : ''}
Candidate just said: "${message}"

Respond naturally as the interviewer:`;

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: systemPrompt });

        res.json({ reply: response.text });
    } catch (error: any) {
        console.error('❌ Voice Chat Error:', error.message);
        res.status(500).json({ error: 'Failed to process voice chat' });
    }
});

// --- Helper Functions ---

function detectJobType(job: any): string {
    const extensions = job.detected_extensions || {};
    const description = (job.description || '').toLowerCase();
    const title = (job.title || '').toLowerCase();

    if (extensions.schedule_type) return extensions.schedule_type;
    if (title.includes('intern')) return 'Internship';
    if (description.includes('full-time') || description.includes('full time')) return 'Full-time';
    if (description.includes('part-time') || description.includes('part time')) return 'Part-time';
    if (description.includes('contract')) return 'Contract';
    if (description.includes('remote')) return 'Remote';
    return 'Full-time';
}

function detectJobTypeFromTitle(title: string): string {
    const t = title.toLowerCase();
    if (t.includes('intern')) return 'Internship';
    if (t.includes('part-time') || t.includes('part time')) return 'Part-time';
    if (t.includes('contract')) return 'Contract';
    if (t.includes('remote')) return 'Remote';
    if (t.includes('freelance')) return 'Freelance';
    return 'Full-time';
}

function extractSalary(job: any): string {
    const extensions = job.detected_extensions || {};
    if (extensions.salary) return extensions.salary;
    const desc = job.description || '';
    const salaryMatch = desc.match(/(?:₹|Rs\.?|INR|USD|\$)\s*[\d,]+(?:\s*[-–to]+\s*(?:₹|Rs\.?|INR|USD|\$)?\s*[\d,]+)?(?:\s*(?:per|\/|p\.?)\s*(?:month|annum|year|hr|hour))?/i);
    if (salaryMatch) return salaryMatch[0];
    return 'Not specified';
}

function detectCategory(title: string): string {
    const t = title.toLowerCase();
    if (t.includes('engineer') || t.includes('developer') || t.includes('software') || t.includes('devops') || t.includes('backend') || t.includes('frontend') || t.includes('full stack')) return 'Engineering';
    if (t.includes('design') || t.includes('ui') || t.includes('ux') || t.includes('graphic')) return 'Design';
    if (t.includes('market') || t.includes('seo') || t.includes('content') || t.includes('social media')) return 'Marketing';
    if (t.includes('sales') || t.includes('business development') || t.includes('account')) return 'Sales';
    if (t.includes('product') || t.includes('project manager') || t.includes('scrum')) return 'Product';
    if (t.includes('data') || t.includes('analyst') || t.includes('machine learning') || t.includes('ai')) return 'Engineering';
    if (t.includes('intern')) return 'Engineering';
    return 'Other';
}

function mapAdzunaCategory(adzunaLabel: string, title: string): string {
    const label = adzunaLabel.toLowerCase();
    if (label.includes('it') || label.includes('engineering') || label.includes('software') || label.includes('tech')) return 'Engineering';
    if (label.includes('design') || label.includes('creative')) return 'Design';
    if (label.includes('marketing') || label.includes('pr') || label.includes('advertising')) return 'Marketing';
    if (label.includes('sales') || label.includes('retail')) return 'Sales';
    if (label.includes('product') || label.includes('project') || label.includes('consult')) return 'Product';
    return detectCategory(title);
}

// Export for Vercel Serverless
export default app;

// Start server locally
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`\n🚀 Hirely Backend Server running at http://localhost:${PORT}`);
        console.log(`📡 SerpApi endpoint: http://localhost:${PORT}/api/jobs/search?q=developer&location=India`);
        console.log(`🍃 Adzuna endpoint: http://localhost:${PORT}/api/jobs/adzuna?q=developer`);
        console.log(`❤️  Health check: http://localhost:${PORT}/api/health\n`);
    });
}



import express from 'express';
import dotenv from 'dotenv';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { createAuthorizedApplication, enrollRole, getPipeline, listAuthorizedApplications, startPipeline, submitPipelineAnswers, updateAuthorizedApplication } from '../src/pipelineBridge.js';

dotenv.config({ path: ['.env.local', '.env'] });

const app = express();
const PORT = 3001;

const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!SERPAPI_KEY) {
    console.warn('⚠️  SERPAPI_KEY is missing. External job search will be unavailable locally.');
}

// Local Vite dev server is the only cross-origin client.
const localOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
app.use((_req, res, next) => {
    const origin = _req.header('origin');
    if (origin && localOrigins.has(origin)) res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// New assessment endpoints authenticate with Clerk and authorize against existing
// application/job records before accessing private pipeline data.
app.post('/api/pipeline/run', startPipeline);
app.post('/api/auth/role', enrollRole);
app.get('/api/pipeline/:applicationId', getPipeline);
app.post('/api/pipeline/answers', submitPipelineAnswers);

// Supabase is only called from this server. The secret key bypasses RLS, so
// every private route verifies Clerk identity and ownership before querying.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase: any = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
const clerk = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null;

async function authorize(req: any, res: any, allowedRoles: string[] = []) {
    if (!clerk || !supabase) { res.status(503).json({ error: 'Server configuration is incomplete' }); return null; }
    const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) { res.status(401).json({ error: 'Authentication required' }); return null; }
    let claims: any;
    try {
        const parties = (process.env.CLERK_AUTHORIZED_PARTIES || '').split(',').map((value: string) => value.trim()).filter(Boolean);
        claims = await verifyToken(bearer, { secretKey: process.env.CLERK_SECRET_KEY!, ...(parties.length ? { authorizedParties: parties } : {}) });
    } catch { res.status(401).json({ error: 'Authentication required' }); return null; }
    if (typeof claims.sub !== 'string') { res.status(401).json({ error: 'Authentication required' }); return null; }
    try {
        const user: any = await clerk.users.getUser(claims.sub);
        const role = user.publicMetadata?.role;
        if (!['candidate', 'recruiter'].includes(role)) { res.status(403).json({ error: 'Account role is not configured' }); return null; }
        if (allowedRoles.length && !allowedRoles.includes(role)) { res.status(403).json({ error: 'Not authorized' }); return null; }
        return { uid: claims.sub, role, user };
    } catch { res.status(401).json({ error: 'Authentication required' }); return null; }
}

async function canAccessApplication(identity: { uid: string; role: string }, applicationId: string) {
    const { data: application, error } = await supabase.from('applications').select('id,candidate_id,employer_id,job_id').eq('id', applicationId).maybeSingle();
    if (error || !application) return null;
    if (identity.role === 'candidate' && application.candidate_id === identity.uid) return application;
    if (identity.role === 'recruiter' && application.employer_id === identity.uid) return application;
    return null;
}

function mapJob(db: any) {
    return { id: db.id, title: db.title, company: db.company, location: db.location, type: db.type,
        salary: db.salary, category: db.category, description: db.description,
        requiredSkills: db.required_skills || [], preferredSkills: db.preferred_skills || [],
        employerId: db.employer_id, postedAt: db.posted_at, logo: db.logo,
        documentUrl: db.document_url, isExternal: false };
}

app.get('/api/db/jobs', async (_req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database is not configured' });
    try {
        const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json((data || []).map(mapJob));
    } catch { res.status(500).json({ error: 'Could not load jobs' }); }
});

app.post('/api/db/jobs', async (req, res) => {
    const identity = await authorize(req, res, ['recruiter']); if (!identity) return;
    const job = req.body || {};
    if (typeof job.id !== 'string' || job.id.length > 200 || typeof job.title !== 'string' || !job.title.trim() || typeof job.company !== 'string' || !job.company.trim()) return res.status(400).json({ error: 'Valid job details are required' });
    try {
        const { data: existing, error: lookupError } = await supabase.from('jobs').select('employer_id').eq('id', job.id).maybeSingle();
        if (lookupError) throw lookupError;
        if (existing && existing.employer_id !== identity.uid) return res.status(409).json({ error: 'Job ID is already in use' });
        const row = { id: job.id, title: job.title.trim(), company: job.company.trim(), location: String(job.location || '').slice(0, 300),
            type: String(job.type || 'Full-time').slice(0, 80), salary: String(job.salary || '').slice(0, 200), category: String(job.category || 'Other').slice(0, 100),
            description: String(job.description || '').slice(0, 40000), required_skills: Array.isArray(job.requiredSkills) ? job.requiredSkills.slice(0, 80) : [],
            preferred_skills: Array.isArray(job.preferredSkills) ? job.preferredSkills.slice(0, 80) : [], employer_id: identity.uid,
            posted_at: String(job.postedAt || new Date().toISOString()).slice(0, 100), logo: String(job.logo || '').slice(0, 2000),
            document_url: typeof job.documentUrl === 'string' ? job.documentUrl.slice(0, 2_800_000) : null };
        const { error } = await supabase.from('jobs').upsert(row);
        if (error) throw error;
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Could not save job' }); }
});

app.delete('/api/db/jobs/:id', async (req, res) => {
    const identity = await authorize(req, res, ['recruiter']); if (!identity) return;
    try {
        const { data, error } = await supabase.from('jobs').delete().eq('id', req.params.id).eq('employer_id', identity.uid).select('id').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Job not found' });
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Could not delete job' }); }
});

app.get('/api/db/applications', listAuthorizedApplications);
app.post('/api/db/applications', createAuthorizedApplication);
app.put('/api/db/applications/:id', updateAuthorizedApplication);

app.get('/api/db/profiles', async (req, res) => {
    const identity = await authorize(req, res, ['recruiter']); if (!identity) return;
    try {
        const { data, error } = await supabase.from('profiles').select('uid,name,role').eq('role', 'candidate').limit(100);
        if (error) throw error;
        res.json(data || []);
    } catch { res.status(500).json({ error: 'Could not load candidate profiles' }); }
});

app.get('/api/db/profiles/:uid', async (req, res) => {
    const identity = await authorize(req, res); if (!identity) return;
    if (req.params.uid !== identity.uid) return res.status(403).json({ error: 'Not authorized' });
    try {
        const { data, error } = await supabase.from('profiles').select('uid,email,name,role').eq('uid', identity.uid).maybeSingle();
        if (error) throw error;
        res.json(data || null);
    } catch { res.status(500).json({ error: 'Could not load profile' }); }
});

app.post('/api/db/profiles', async (req, res) => {
    const identity = await authorize(req, res); if (!identity) return;
    if (req.body?.uid !== identity.uid) return res.status(403).json({ error: 'Not authorized' });
    const email = identity.user.emailAddresses?.find((item: any) => item.id === identity.user.primaryEmailAddressId)?.emailAddress || '';
    const name = String(identity.user.fullName || req.body?.name || email.split('@')[0] || 'User').slice(0, 200);
    try {
        const { error } = await supabase.from('profiles').upsert({ uid: identity.uid, email, name, role: identity.role, updated_at: new Date().toISOString() });
        if (error) throw error;
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Could not save profile' }); }
});

app.get('/api/db/messages/:appId', async (req, res) => {
    const identity = await authorize(req, res); if (!identity) return;
    if (!await canAccessApplication(identity, req.params.appId)) return res.status(404).json({ error: 'Application not found' });
    try {
        const { data, error } = await supabase.from('messages').select('*').eq('application_id', req.params.appId).order('timestamp', { ascending: true });
        if (error) throw error;
        res.json((data || []).map((db: any) => ({ id: db.id, applicationId: db.application_id, senderId: db.sender_id,
            text: db.content, timestamp: Number(db.timestamp), isAi: db.is_ai, isVideoCallRequest: db.is_video_call_request,
            videoCallStatus: db.video_call_status, videoCallUrl: db.video_call_url })));
    } catch { res.status(500).json({ error: 'Could not load messages' }); }
});

app.post('/api/db/messages/:appId', async (req, res) => {
    const identity = await authorize(req, res); if (!identity) return;
    if (!await canAccessApplication(identity, req.params.appId)) return res.status(404).json({ error: 'Application not found' });
    const msg = req.body || {};
    if (typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 4000) return res.status(400).json({ error: 'Message must contain 1 to 4,000 characters' });
    const callRequest = identity.role === 'recruiter' && msg.isVideoCallRequest === true;
    try {
        const { error } = await supabase.from('messages').insert({ id: String(msg.id || Date.now()), application_id: req.params.appId,
            sender_id: identity.uid, content: msg.text.trim(), timestamp: Date.now(), is_ai: false,
            is_video_call_request: callRequest, video_call_status: callRequest ? 'pending' : null,
            video_call_url: callRequest && typeof msg.videoCallUrl === 'string' && msg.videoCallUrl.startsWith('https://meet.jit.si/') ? msg.videoCallUrl : null });
        if (error) throw error;
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Could not send message' }); }
});

app.put('/api/db/messages/:appId/:msgId', async (req, res) => {
    const identity = await authorize(req, res); if (!identity) return;
    if (!await canAccessApplication(identity, req.params.appId)) return res.status(404).json({ error: 'Application not found' });
    const status = req.body?.videoCallStatus;
    if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid call response' });
    try {
        const { data: message, error: readError } = await supabase.from('messages').select('sender_id,is_video_call_request').eq('id', req.params.msgId).eq('application_id', req.params.appId).maybeSingle();
        if (readError) throw readError;
        if (!message || !message.is_video_call_request || message.sender_id === identity.uid) return res.status(404).json({ error: 'Call request not found' });
        const { error } = await supabase.from('messages').update({ video_call_status: status }).eq('id', req.params.msgId).eq('application_id', req.params.appId);
        if (error) throw error;
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Could not update call request' }); }
});

// --- Google Jobs via SerpApi ---
app.get('/api/jobs/search', async (req, res) => {
    try {
        if (!SERPAPI_KEY) return res.status(503).json({ error: 'External job search is not configured' });
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
    const identity = await authorize(req, res); if (!identity) return;
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
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`\n🚀 Hirely Backend Server running at http://localhost:${PORT}`);
        console.log(`📡 SerpApi endpoint: http://localhost:${PORT}/api/jobs/search?q=developer&location=India`);
        console.log(`🍃 Adzuna endpoint: http://localhost:${PORT}/api/jobs/adzuna?q=developer`);
        console.log(`❤️  Health check: http://localhost:${PORT}/api/health\n`);
    });
}


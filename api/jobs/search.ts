import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const SERPAPI_KEY = process.env.SERPAPI_KEY;
        if (!SERPAPI_KEY) {
            return res.status(500).json({ success: false, error: 'SERPAPI_KEY is not configured' });
        }

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
                console.error(`SerpApi error (page ${page + 1}):`, await serpResponse.text());
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
                if (job.via) {
                    source = job.via.replace('via ', '');
                }

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

        res.json({
            success: true,
            count: allJobs.length,
            query,
            location,
            jobs: allJobs,
        });
    } catch (error: any) {
        console.error('Error fetching jobs from SerpApi:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch jobs',
            message: error.message,
        });
    }
}

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

/// <reference types="vite/client" />
import { Job } from '../types';

export const fetchExternalJobs = async (searchQuery: string = 'Software Developer'): Promise<Job[]> => {
  try {
    const jobs: Job[] = [];

    // --- Primary: Adzuna API (India real-time jobs) ---
    try {
      const encodedQuery = encodeURIComponent(searchQuery);
      const adzunaResponse = await fetch(`/api/jobs/adzuna?q=${encodedQuery}&results_per_page=20`);
      if (adzunaResponse.ok) {
        const adzunaData = await adzunaResponse.json();
        if (adzunaData.success && adzunaData.jobs) {
          jobs.push(...adzunaData.jobs);
        }
      }
    } catch (err) {
      console.error("Error fetching from Adzuna:", err);
    }

    // --- Fallback: SerpApi Google Jobs (if Adzuna returns nothing) ---
    if (jobs.length === 0) {
      try {
        const encodedQuery = encodeURIComponent(searchQuery);
        const serpResponse = await fetch(`/api/jobs/search?q=${encodedQuery}&location=India&pages=2`);
        if (serpResponse.ok) {
          const serpData = await serpResponse.json();
          if (serpData.success && serpData.jobs) {
            jobs.push(...serpData.jobs);
          }
        }
      } catch (err) {
        console.error("Error fetching from SerpApi backend:", err);
      }
    }

    return jobs;
  } catch (error) {
    console.error("Error fetching external jobs:", error);
    return [];
  }
};

const RESUME_QUERY_STOP_WORDS = new Set(['and', 'for', 'with', 'from', 'the', 'job', 'jobs', 'india', 'role', 'roles', 'developer', 'professional']);

/** Ranks external results against the role titles and skills extracted from a resume. */
export const rankJobsForResume = (jobs: Job[], resumeQuery: string): Job[] => {
  const terms = [...new Set(resumeQuery.toLowerCase().match(/[a-z0-9+#.]+/g) || [])]
    .filter(term => term.length > 1 && !RESUME_QUERY_STOP_WORDS.has(term));
  if (!terms.length) return [];

  return jobs.map(job => {
    const title = job.title.toLowerCase();
    const category = (job.category || '').toLowerCase();
    const skills = [...(job.requiredSkills || []), ...(job.preferredSkills || [])].join(' ').toLowerCase();
    const description = (job.description || '').toLowerCase();
    const company = (job.company || '').toLowerCase();
    let weightedScore = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      let weight = 0;
      if (title.includes(term)) weight += 4;
      if (skills.includes(term)) weight += 3;
      if (category.includes(term)) weight += 2;
      if (company.includes(term)) weight += 1;
      if (description.includes(term)) weight += 0.5;
      if (weight > 0) matchedTerms += 1;
      weightedScore += weight;
    }
    const matchScore = matchedTerms ? Math.min(99, Math.round(weightedScore / (terms.length * 4) * 100)) : 0;
    return { job, matchScore, matchedTerms, weightedScore };
  })
    .filter(result => result.matchedTerms > 0)
    .sort((a, b) => b.weightedScore - a.weightedScore || b.matchedTerms - a.matchedTerms)
    .map(({ job, matchScore }) => ({ ...job, aiMatchScore: matchScore }));
};

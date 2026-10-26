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

    // Shuffle jobs slightly for variety
    return jobs.sort(() => Math.random() - 0.5);
  } catch (error) {
    console.error("Error fetching external jobs:", error);
    return [];
  }
};

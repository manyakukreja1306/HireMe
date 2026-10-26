/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring } from 'motion/react';
import {
  Search,
  MapPin,
  Briefcase,
  Building2,
  Zap,
  Trophy,
  ChevronRight,
  Menu,
  X,
  ArrowRight,
  ArrowDown,
  Star,
  Users,
  CheckCircle2,
  Globe,
  Mail,
  Lock,
  Settings,
  MousePointerClick,
  Bot,
  ChevronDown,
  FileText,
  Upload,
  CircleDot,
  Rocket,
  Layout,
  Triangle,
  Hash,
  Gamepad2,
  Framer
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { companies, stats } from './data';
import { Job, Company } from './types';
import { useUser, useAuth, SignIn, SignUp, UserButton, useClerk } from '@clerk/clerk-react';
import { UserProfile, Application } from './types';
import { fetchExternalJobs } from './services/jobApi';
import { Chatbot } from './components/Chatbot';
import { AIHeadhunter } from './components/AIHeadhunter';
import { AIVoiceInterview } from './components/AIVoiceInterview';
import { PipelineAssessment } from './components/PipelineAssessment';

// --- API helpers ---
const API_TIMEOUT = 8000; // 8 second timeout for DB calls

// --- localStorage fallback helpers ---
const LOCAL_PROFILES_KEY = 'hirely_profiles';
const LOCAL_APPS_KEY = 'hirely_applications';

function getLocalProfiles(): Record<string, UserProfile> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROFILES_KEY) || '{}');
  } catch { return {}; }
}

function saveLocalProfile(profile: UserProfile) {
  const profiles = getLocalProfiles();
  profiles[profile.uid] = profile;
  localStorage.setItem(LOCAL_PROFILES_KEY, JSON.stringify(profiles));
}

function getLocalApplications(): Application[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_APPS_KEY) || '[]');
  } catch { return []; }
}

function saveLocalApplications(apps: Application[]) {
  localStorage.setItem(LOCAL_APPS_KEY, JSON.stringify(apps));
}

async function apiGetStoredProfile(uid: string): Promise<UserProfile | null> {
  try {
    const res = await fetch(`/api/db/profiles/${uid}`, { signal: AbortSignal.timeout(API_TIMEOUT) });
    if (!res.ok) throw new Error('API error');
    const profile = await res.json();
    if (profile) {
      saveLocalProfile(profile); // cache locally
      return profile;
    }
  } catch { /* Supabase API unavailable; use the local cache. */ }
  // Fallback to localStorage
  const local = getLocalProfiles();
  return local[uid] || null;
}

async function apiSaveProfile(profile: UserProfile) {
  // Always save to localStorage
  saveLocalProfile(profile);
  try {
    await fetch('/api/db/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
  } catch (error) {
    console.warn('Profile could not be saved to Supabase; it remains in the local cache.');
  }
}

async function apiGetStoredApplications(token?: string): Promise<Application[]> {
  const localApps = getLocalApplications();
  try {
    const res = await fetch('/api/db/applications', { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(API_TIMEOUT) });
    if (!res.ok) return localApps;
    const dbApps: Application[] = await res.json();
    // Merge: DB apps + local apps not in DB
    const localById = new Map(localApps.map(a => [a.id, a]));
    const dbIds = new Set(dbApps.map(a => a.id));
    const merged = [
      ...dbApps.map(app => ({ ...localById.get(app.id), ...app, resumeUrl: localById.get(app.id)?.resumeUrl || '' })),
      ...localApps.filter(a => !dbIds.has(a.id))
    ];
    return merged;
  } catch {
    return localApps;
  }
}

async function apiAddApplication(app: Application, token?: string) {
  // Always save to localStorage
  const localApps = getLocalApplications();
  saveLocalApplications([...localApps, app]);
  try {
    const response = await fetch('/api/db/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(app),
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
    if (!response.ok) throw new Error('Application could not be saved to the server');
  } catch {
    console.warn('Application could not be saved to Supabase; it remains in the local cache.');
  }
}

async function apiUpdateApplicationStatus(id: string, status: string, token?: string) {
  // Update in localStorage
  const localApps = getLocalApplications();
  saveLocalApplications(localApps.map(a => a.id === id ? { ...a, status: status as Application['status'] } : a));
  try {
    const response = await fetch(`/api/db/applications/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
    if (!response.ok) throw new Error('Application status update was rejected');
  } catch {
    console.warn('Application status could not be saved to Supabase.');
  }
}

// --- Custom Hooks ---
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// --- localStorage helpers for job fallback ---
const LOCAL_JOBS_KEY = 'hirely_posted_jobs';

function getLocalJobs(): Job[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || '[]');
  } catch { return []; }
}

function saveLocalJobs(jobs: Job[]) {
  localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(jobs));
}

async function apiGetStoredJobs(): Promise<Job[]> {
  const localJobs = getLocalJobs();
  try {
    const res = await fetch('/api/db/jobs', { signal: AbortSignal.timeout(API_TIMEOUT) });
    if (!res.ok) return localJobs;
    const dbJobs: Job[] = await res.json();
    // Merge: DB jobs + any local jobs not in DB (deduped by id)
    const dbIds = new Set(dbJobs.map(j => j.id));
    const merged = [...dbJobs, ...localJobs.filter(j => !dbIds.has(j.id))];
    return merged;
  } catch {
    return localJobs; // Supabase API unavailable; return cached jobs.
  }
}

async function apiAddPostedJob(job: Job) {
  // Always save to localStorage as backup
  const localJobs = getLocalJobs();
  saveLocalJobs([...localJobs, job]);
  // Persist portal jobs to Supabase.
  try {
    await fetch('/api/db/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
  } catch {
    console.warn('Job could not be saved to Supabase; it remains in the local cache.');
  }
}

// Helper for large Base64 files (Resumes/Docs)
function downloadBase64File(base64Data: string, fileName: string) {
  try {
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error("Download failed:", e);
    // Fallback: try window.open
    const win = window.open();
    if (win) {
      win.document.write('<iframe src="' + base64Data + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
    }
  }
}

async function apiDeletePostedJob(jobId: string) {
  // Remove from localStorage
  saveLocalJobs(getLocalJobs().filter(j => j.id !== jobId));
  // Remove the portal job from Supabase.
  try {
    await fetch(`/api/db/jobs/${jobId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
  } catch {
    console.warn('Job could not be deleted from Supabase.');
  }
}
import { ChatModal } from './components/ChatModal';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const Navbar = ({ activePage, setActivePage }: { activePage: string, setActivePage: (p: string) => void }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'jobs', label: 'Find Jobs' },
  ];

  return (
    <nav className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-6 py-4",
      isScrolled ? "glass py-3" : "bg-transparent"
    )}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div
          className="flex items-center gap-1 cursor-pointer"
          onClick={() => setActivePage('home')}
        >
          <span className="text-3xl font-display font-bold tracking-tighter text-slate-900">Hirely<span className="text-well-red">:</span></span>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={cn(
                "text-sm font-medium transition-colors hover:text-well-red",
                activePage === item.id ? "text-well-red" : "text-slate-600"
              )}
            >
              {item.label}
            </button>
          ))}



          {isSignedIn ? (
            <div className="flex items-center gap-4">
              <button onClick={() => setActivePage('dashboard')} className="text-sm font-medium text-slate-600 hover:text-well-red">Dashboard</button>
              <UserButton afterSignOutUrl="/" />
            </div>
          ) : (
            <button
              onClick={() => setActivePage('join')}
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-indigo-700 transition-all hover:shadow-lg hover:shadow-indigo-200"
            >
              Join Portal
            </button>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button className="md:hidden text-slate-900" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 right-0 bg-white border-t border-slate-100 p-6 flex flex-col gap-4 md:hidden shadow-xl"
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActivePage(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={cn(
                  "text-left text-lg font-medium py-2",
                  activePage === item.id ? "text-indigo-600" : "text-slate-600"
                )}
              >
                {item.label}
              </button>
            ))}
            {isSignedIn ? (
              <>
                <button onClick={() => { setActivePage('dashboard'); setIsMobileMenuOpen(false); }} className="text-left text-lg font-medium py-2 text-slate-600">Dashboard</button>
                <div className="mt-2 flex justify-center">
                  <UserButton afterSignOutUrl="/" />
                </div>
              </>
            ) : (
              <button
                onClick={() => {
                  setActivePage('join');
                  setIsMobileMenuOpen(false);
                }}
                className="bg-indigo-600 text-white px-6 py-3 rounded-xl text-center font-semibold mt-2"
              >
                Join Portal
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const JobCard: React.FC<{ job: Job; onApply: () => void; onViewDetails?: () => void; isApplying?: boolean; hasApplied?: boolean }> = ({ job, onApply, onViewDetails, isApplying, hasApplied }) => (
  <motion.div
    layout
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    whileHover={{ y: -5 }}
    className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all group flex flex-col h-full"
  >
    <div className="flex justify-between items-start mb-4">
      <div className="flex gap-4">
        <img
          src={job.logo}
          alt={job.company}
          referrerPolicy="no-referrer"
          className="w-14 h-14 rounded-2xl object-cover border border-slate-100"
        />
        <div>
          <h3 className="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">{job.title}</h3>
          <p className="text-slate-500 text-sm flex items-center gap-1">
            <Building2 className="w-3 h-3" /> {job.company}
          </p>
        </div>
      </div>
      {job.aiMatchScore && (
        <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 whitespace-nowrap ml-2">
          <Zap className="w-3 h-3 fill-emerald-500" /> {job.aiMatchScore}% Match
        </div>
      )}
    </div>

    <div className="flex flex-wrap gap-2 mb-4">
      <span className="bg-slate-50 text-slate-600 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
        <MapPin className="w-3 h-3" /> {job.location}
      </span>
      <span className="bg-slate-50 text-slate-600 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
        <Briefcase className="w-3 h-3" /> {job.type}
      </span>
      <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-xs font-bold">
        {job.salary}
      </span>
    </div>

    <p className="text-slate-600 text-sm mb-6 line-clamp-3 flex-grow">{job.description}</p>

    <div className="flex items-center justify-between pt-4 border-t border-slate-50 mt-auto">
      <span className="text-slate-400 text-xs">Posted {job.postedAt}</span>
      <div className="flex gap-3">
        {onViewDetails && (
          <button
            onClick={onViewDetails}
            className="text-slate-500 font-bold text-sm hover:text-slate-700 transition-all"
          >
            Details
          </button>
        )}
        <button
          onClick={onApply}
          disabled={isApplying || hasApplied}
          className={cn(
            "font-bold text-sm flex items-center gap-1 transition-all",
            hasApplied ? "text-emerald-600" : "text-indigo-600 hover:gap-2 disabled:opacity-50"
          )}
        >
          {hasApplied ? (
            <><CheckCircle2 className="w-4 h-4" /> Applied</>
          ) : isApplying ? (
            'Applying...'
          ) : (
            <>Apply <ArrowRight className="w-4 h-4" /></>
          )}
        </button>
      </div>
    </div>
  </motion.div>
);

const JobDetailsModal = ({ job, onClose, onApply, isApplying, hasApplied }: { job: Job, onClose: () => void, onApply: () => void, isApplying?: boolean, hasApplied?: boolean }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-[2rem] p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative"
    >
      <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600">
        <X className="w-6 h-6" />
      </button>

      <div className="flex gap-6 items-start mb-8">
        <img src={job.logo} alt={job.company} referrerPolicy="no-referrer" className="w-20 h-20 rounded-2xl object-cover border border-slate-100" />
        <div>
          <h2 className="text-3xl font-bold text-slate-900 mb-2">{job.title}</h2>
          <p className="text-lg text-slate-600 flex items-center gap-2">
            <Building2 className="w-5 h-5" /> {job.company}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-8">
        <span className="bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"><MapPin className="w-4 h-4" /> {job.location}</span>
        <span className="bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"><Briefcase className="w-4 h-4" /> {job.type}</span>
        <span className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl text-sm font-bold">{job.salary}</span>
        {job.isExternal && <span className="bg-amber-50 text-amber-700 px-4 py-2 rounded-xl text-sm font-bold">External Listing</span>}
      </div>

      <div className="mb-8">
        <h3 className="text-xl font-bold text-slate-900 mb-4">Job Description</h3>
        <div className="text-slate-600 leading-relaxed whitespace-pre-wrap">
          {job.description}
        </div>
      </div>

      <div className="flex justify-end gap-4 pt-6 border-t border-slate-100">
        <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Close</button>
        <button
          onClick={onApply}
          disabled={isApplying || hasApplied}
          className={cn(
            "px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all",
            hasApplied ? "bg-emerald-100 text-emerald-700" : "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          )}
        >
          {hasApplied ? 'Applied' : isApplying ? 'Applying...' : (job.isExternal ? 'Apply Externally' : 'Apply Now')}
        </button>
      </div>
    </motion.div>
  </div>
);

const FloatingPill = ({ text, top, left, depth, delay, onClick }: { text: string, top: string, left?: string, depth: number, delay: number, onClick: () => void }) => {
  const { scrollY } = useScroll();
  const yScroll = useTransform(scrollY, [0, 1000], [0, depth * -120]);

  const springConfig = { damping: 25, stiffness: 50, mass: 1 };
  const xMouse = useSpring(0, springConfig);
  const yMouse = useSpring(0, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const deltaX = (centerX - e.clientX) * depth * 0.08;
      const deltaY = (centerY - e.clientY) * depth * 0.08;

      xMouse.set(deltaX);
      yMouse.set(deltaY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [depth, xMouse, yMouse]);

  // Precise Wellfound Style
  const scale = depth < 1 ? 0.8 : depth > 1.8 ? 1.05 : 0.9;
  const opacity = depth < 1 ? 0.3 : depth < 1.4 ? 0.6 : 0.9;
  const zIndex = depth > 1.5 ? 20 : 0;

  const baseClasses = "block backdrop-blur-sm border border-slate-200/50 shadow-sm rounded-[12px] px-5 py-2.5 text-[14px] font-medium leading-tight cursor-pointer whitespace-nowrap transition-all tracking-tight bg-white/95 text-slate-600 hover:text-well-red hover:border-well-red/30";

  return (
    <motion.div
      style={{ top, left, y: yScroll, scale, opacity, zIndex }}
      className="absolute pointer-events-auto"
    >
      <motion.button
        onClick={onClick}
        style={{ x: xMouse, y: yMouse }}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay }}
        whileHover={{ scale: 1.05, transition: { duration: 0.2 } }}
        className={baseClasses}
      >
        {text}
      </motion.button>
    </motion.div>
  );
};

const SplitFeatures = () => (
  <section className="flex flex-col md:flex-row w-full border-t border-slate-200">
    {/* Left Side */}
    <div className="flex-1 bg-white p-12 md:p-24">
      <h3 className="text-lg font-bold text-slate-900 mb-4">Got talent?</h3>
      <h2 className="text-4xl md:text-5xl font-display font-bold text-slate-900 mb-12">Why job seekers love us</h2>

      <div className="space-y-10">
        <FeatureItem
          icon={<Star className="w-6 h-6 text-rose-500" />}
          text="Connect directly with founders at top startups - no third party recruiters allowed."
        />
        <FeatureItem
          icon={<Briefcase className="w-6 h-6 text-rose-500" />}
          text="Everything you need to know, all upfront. View salary, stock options, and more before applying."
        />
        <FeatureItem
          icon={<CheckCircle2 className="w-6 h-6 text-rose-500" />}
          text="Say goodbye to cover letters - your profile is all you need. One click to apply and you're done."
        />
        <FeatureItem
          icon={<Zap className="w-6 h-6 text-rose-500" />}
          text="Unique jobs at startups and tech companies you can't find anywhere else."
        />
      </div>
    </div>

    {/* Right Side */}
    <div className="flex-1 bg-[#fff8f8] p-12 md:p-24">
      <h3 className="text-lg font-bold text-slate-900 mb-4">Need talent?</h3>
      <h2 className="text-4xl md:text-5xl font-display font-bold text-slate-900 mb-12">Why recruiters love us</h2>

      <div className="space-y-10">
        <FeatureItem
          icon={<Users className="w-6 h-6 text-rose-500" />}
          text="Tap into a community of 10M+ engaged, startup-ready candidates."
        />
        <FeatureItem
          icon={<Settings className="w-6 h-6 text-rose-500" />}
          text="Everything you need to kickstart your recruiting — set up job posts, company branding, and HR tools within 10 minutes, all for free."
        />
        <FeatureItem
          icon={<MousePointerClick className="w-6 h-6 text-rose-500" />}
          text="A free applicant tracking system, or free integration with any ATS you may already use."
        />
        <FeatureItem
          icon={<Bot className="w-6 h-6 text-rose-500" />}
          text="Let us handle the heavy-lifting with Hirely AI. Our new AI-Recruiter scans 500M+ candidates, filters it down based on your unique calibration, and schedules your favorites on your calendar in a matter of days."
        />
      </div>
    </div>
  </section>
);

const FeatureItem = ({ icon, text }: { icon: React.ReactNode, text: string }) => (
  <div className="flex gap-6 items-start">
    <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
      {icon}
    </div>
    <p className="text-slate-700 leading-relaxed text-lg">{text}</p>
  </div>
);

const AiRecruiterSection = ({ onLearnMore }: { onLearnMore: () => void }) => (
  <section className="p-6 md:p-12 bg-white">
    <div className="max-w-7xl mx-auto bg-[#1a1122] rounded-[3rem] p-12 md:p-20 flex flex-col lg:flex-row items-center gap-16 overflow-hidden relative">
      <div className="flex-1 z-10">
        <h2 className="text-5xl md:text-6xl font-display font-bold text-white mb-8 leading-tight">
          Meet Autopilot:<br />Hirely's AI recruiter
        </h2>
        <p className="text-xl text-white/80 mb-8 leading-relaxed max-w-lg">
          Just tell us what you need. Our expert recruiters backed by AI deliver qualified candidates to your calendar.
        </p>
        <p className="text-xl text-white/80 mb-12 max-w-lg">
          All at a fraction of the cost of an agency.
        </p>
        <button
          onClick={onLearnMore}
          className="bg-white text-slate-900 px-8 py-4 rounded-full font-bold text-lg hover:bg-slate-100 transition-all"
        >
          Learn more
        </button>
      </div>

      <div className="flex-1 relative z-10 w-full hidden md:block">
        <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-md ml-auto relative mt-24">
          <div className="absolute -top-16 -left-12 bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 w-80">
            <div className="w-10 h-10 rounded-full bg-indigo-100 overflow-hidden shrink-0">
              <img src="https://picsum.photos/seed/recruiter/100/100" alt="Recruiter" referrerPolicy="no-referrer" />
            </div>
            <p className="text-sm font-medium">Send me candidates interested in <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs">FINTECH</span> with experience in <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-xs">PYTHON</span></p>
          </div>

          <div className="absolute -top-32 right-0 bg-rose-500 text-white p-4 rounded-2xl shadow-xl rounded-br-none w-64">
            <p className="text-sm font-medium">Absolutely! Sending you a list of relevant candidates now.</p>
          </div>

          <h3 className="text-xl font-bold text-rose-900 mb-6 mt-8">Your qualified candidate review list</h3>

          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 border border-slate-100 rounded-2xl hover:shadow-md transition-all bg-white">
                <div className="flex items-center gap-4">
                  <img src={`https://picsum.photos/seed/cand${i}/100/100`} className="w-12 h-12 rounded-full object-cover" alt="Candidate" referrerPolicy="no-referrer" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-900">Candidate {i}</h4>
                      <span className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded-full font-bold">INTERESTED</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Experience in <span className="bg-slate-100 px-1.5 py-0.5 rounded">PYTHON</span></p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="w-8 h-8 rounded-full border border-emerald-200 flex items-center justify-center text-emerald-600 hover:bg-emerald-50"><CheckCircle2 className="w-4 h-4" /></button>
                  <button className="w-8 h-8 rounded-full border border-rose-200 flex items-center justify-center text-rose-600 hover:bg-rose-50"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </section>
);

const CompanyMarquee = ({ onCompanyClick }: { onCompanyClick: (name: string) => void }) => {
  const logos = [
    { name: "STRIPE", icon: <Zap className="w-5 h-5 text-indigo-400" /> },
    { name: "Coinbase", icon: <CircleDot className="w-5 h-5 text-blue-400" /> },
    { name: "airbnb", icon: <Building2 className="w-5 h-5 text-rose-400" /> },
    { name: "SPACEX", icon: <Rocket className="w-5 h-5 text-slate-400" /> },
    { name: "TESLA", icon: <Zap className="w-5 h-5 text-red-500" /> },
    { name: "Notion", icon: <FileText className="w-5 h-5 text-white" /> },
    { name: "Linear", icon: <Layout className="w-5 h-5 text-indigo-300" /> },
    { name: "Framer", icon: <Framer className="w-5 h-5 text-pink-400" /> },
    { name: "Vercel", icon: <Triangle className="w-5 h-5 text-white fill-white" /> },
    { name: "Slack", icon: <Hash className="w-5 h-5 text-amber-400" /> },
    { name: "Discord", icon: <Gamepad2 className="w-5 h-5 text-indigo-500" /> },
  ];

  return (
    <div className="w-full overflow-hidden bg-[#1a1122] py-20 relative flex flex-col items-center">
      <div className="w-full border-t border-white/10 absolute top-0"></div>
      <div className="absolute inset-y-0 left-0 w-16 md:w-32 bg-gradient-to-r from-[#1a1122] to-transparent z-10"></div>
      <div className="absolute inset-y-0 right-0 w-16 md:w-32 bg-gradient-to-l from-[#1a1122] to-transparent z-10"></div>

      <div className="flex w-max animate-marquee gap-24 md:gap-32 px-8 mb-12 items-center">
        {[...logos, ...logos, ...logos].map((logo, i) => (
          <div key={i} onClick={() => onCompanyClick(logo.name)} className="flex items-center gap-3 cursor-pointer group hover:scale-105 transition-transform duration-300">
            {logo.icon}
            <span className={cn(
              "text-2xl font-bold tracking-tight text-white/90 group-hover:text-well-red transition-colors",
              logo.name === 'airbnb' ? "font-serif lowercase" : "font-sans uppercase"
            )}>
              {logo.name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="h-px w-8 bg-well-red/50"></span>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Market Leading Environments</p>
        <span className="h-px w-8 bg-well-red/50"></span>
      </div>
      <p className="text-sm text-white/70 font-medium">Powering the next generation of builders</p>
    </div>
  );
};

// --- Pages ---

const HomePage = ({ setActivePage, setSearchQuery, onCompanyClick }: { setActivePage: (p: string) => void, setSearchQuery: (q: string) => void, onCompanyClick: (name: string) => void }) => {
  const handlePillClick = (query: string) => {
    setSearchQuery(query);
    setActivePage('jobs');
  };

  return (
    <div className="pt-32 pb-0 bg-white min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="relative px-6 flex-grow flex flex-col items-center justify-center min-h-[70vh]">

        {/* Floating Pills Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none hidden md:block z-0 opacity-80">
          <div className="relative w-full max-w-7xl mx-auto h-full">
            <FloatingPill text="React Developers" top="18%" left="30%" depth={0.8} delay={0} onClick={() => handlePillClick('React')} />
            <FloatingPill text="Mental Health" top="32%" left="15%" depth={1.2} delay={1} onClick={() => handlePillClick('Mental Health')} />
            <FloatingPill text="Web3" top="15%" left="8%" depth={0.6} delay={2} onClick={() => handlePillClick('Web3')} />
            <FloatingPill text="Databases" top="15%" left="40%" depth={0.5} delay={0} onClick={() => handlePillClick('Databases')} />
            <FloatingPill text="Front End Developers" top="18%" left="45%" depth={0.4} delay={0.5} onClick={() => handlePillClick('Front End')} />
            <FloatingPill text="SaaS" top="20%" left="55%" depth={0.6} delay={0.2} onClick={() => handlePillClick('SaaS')} />

            <FloatingPill text="Hardware" top="40%" left="18%" depth={1.0} delay={1.5} onClick={() => handlePillClick('Hardware')} />
            <FloatingPill text="Android Developers" top="52%" left="10%" depth={1.4} delay={0.2} onClick={() => handlePillClick('Android')} />
            <FloatingPill text="Austin" top="48%" left="25%" depth={0.7} delay={0.8} onClick={() => handlePillClick('Austin')} />

            <FloatingPill text="iOS Developers" top="22%" left="72%" depth={0.5} delay={1.2} onClick={() => handlePillClick('iOS')} />
            <FloatingPill text="Node JS Developers" top="25%" left="22%" depth={1.1} delay={0.3} onClick={() => handlePillClick('Node')} />
            <FloatingPill text="Seattle" top="22%" left="80%" depth={1.0} delay={0.9} onClick={() => handlePillClick('Seattle')} />
            <FloatingPill text="New York" top="28%" left="84%" depth={1.5} delay={1.8} onClick={() => handlePillClick('New York')} />

            <FloatingPill text="Cyber Security" top="50%" left="80%" depth={1.6} delay={0.6} onClick={() => handlePillClick('Cyber Security')} />
            <FloatingPill text="E-commerce" top="35%" left="68%" depth={2.2} delay={0.1} onClick={() => handlePillClick('E-commerce')} />
            <FloatingPill text="San Francisco" top="42%" left="58%" depth={0.8} delay={1.4} onClick={() => handlePillClick('San Francisco')} />
            <FloatingPill text="Denver" top="48%" left="58%" depth={0.5} delay={0.6} onClick={() => handlePillClick('Denver')} />
            <FloatingPill text="Robotics" top="45%" left="65%" depth={0.6} delay={0.4} onClick={() => handlePillClick('Robotics')} />
            <FloatingPill text="Blockchain Developers" top="52%" left="50%" depth={1.2} delay={1.1} onClick={() => handlePillClick('Blockchain')} />
          </div>
        </div>

        <div className="z-20 relative mt-20 flex justify-center w-full">
          <div className="flex items-center justify-center gap-8 relative pb-4 pt-4 z-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.5, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="hidden lg:flex items-baseline gap-[0.5rem]">
              <span className="text-6xl md:text-[6.5rem] font-sans font-black text-well-black tracking-[-0.05em] leading-none block">h</span>
              <div className="flex flex-col gap-2.5 relative -top-4">
                <div className="w-[18px] h-[18px] rounded-full bg-well-red"></div>
                <div className="w-[18px] h-[18px] rounded-full bg-well-red"></div>
              </div>
            </motion.div>

            <motion.h1
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, ease: "easeOut", type: "spring", bounce: 0.2 }}
              className="text-6xl md:text-[64px] font-sans font-semibold text-well-black tracking-[-0.8px] px-10 md:px-14 py-6 md:py-7 border-[1.5px] border-dashed border-well-red rounded-[16px] bg-white relative z-20 shadow-sm leading-[1.1] whitespace-nowrap">
              Find what's next
            </motion.h1>
          </div>
        </div>

        <div className="w-full max-w-7xl mx-auto border-t border-slate-100 my-4" />

        <div className="mt-12 md:mt-20 text-center z-20 relative">
          <h2 className="text-3xl md:text-[40px] font-sans font-semibold tracking-[-0.8px] text-well-black mb-12 leading-[1.3]">
            Where startups and job seekers connect
          </h2>
          <div className="flex flex-col sm:flex-row gap-5 justify-center mt-12">
            <button
              onClick={() => setActivePage('join')}
              className="bg-well-black text-white px-8 py-4 rounded-[12px] font-semibold text-lg hover:bg-black transition-all shadow-md"
            >
              Find your next hire
            </button>
            <button
              onClick={() => { setSearchQuery(''); setActivePage('jobs'); }}
              className="bg-white text-well-black border border-slate-200 px-8 py-4 rounded-[12px] font-semibold text-lg hover:border-slate-300 transition-all shadow-sm"
            >
              Find your next job
            </button>
          </div>
        </div>

        <div className="mt-16 md:mt-24 mb-12 animate-bounce">
          <div className="w-12 h-12 bg-[#1a1122] rounded-full flex items-center justify-center text-white mx-auto">
            <ArrowDown className="w-6 h-6" />
          </div>
        </div>
      </section>

      <CompanyMarquee onCompanyClick={onCompanyClick} />
      <SplitFeatures />
      <AiRecruiterSection onLearnMore={() => setActivePage('jobs')} />
    </div>
  );
};

const ConfirmApplyModal = ({ job, onConfirm, onCancel }: { job: Job, onConfirm: () => void, onCancel: () => void }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl relative"
    >
      <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
        <Globe className="w-8 h-8" />
      </div>
      <h3 className="text-2xl font-bold text-slate-900 mb-2 text-center">External Application</h3>
      <p className="text-slate-600 mb-8 text-center text-sm">
        We opened <strong>{job.company}</strong> in a new tab. Did you successfully complete your application on their site?
      </p>
      <div className="flex flex-col gap-3">
        <button onClick={onConfirm} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors">
          Yes, I applied
        </button>
        <button onClick={onCancel} className="w-full py-4 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors">
          No, maybe later
        </button>
      </div>
    </motion.div>
  </div>
);

const JobsPage = ({ userProfile, setActivePage, initialSearch = '' }: { userProfile: UserProfile | null, setActivePage: (p: string) => void, initialSearch?: string }) => {
  const { getToken } = useAuth();
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState('All');

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const [appliedJobs, setAppliedJobs] = useState<string[]>([]);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [externalApplyModalJob, setExternalApplyModalJob] = useState<Job | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(search, 500);

  useEffect(() => {
    const fetchJobsAndApps = async () => {
      setLoading(true);
      try {
        // Determine dynamic query based on active category and search
        let dynamicQuery = '';
        if (debouncedSearch) {
          dynamicQuery = `${debouncedSearch} ${category !== 'All' ? category : ''} Jobs India`;
        } else if (category !== 'All') {
          dynamicQuery = `${category} Jobs India`;
        } else {
          dynamicQuery = 'Developer OR Internship India';
        }

        // Fetch posted jobs and external jobs IN PARALLEL
        // so a slow Supabase request doesn't block external results
        const [postedJobsResult, externalJobsResult] = await Promise.allSettled([
          apiGetStoredJobs(),
          fetchExternalJobs(dynamicQuery.trim())
        ]);

        const postedJobs = postedJobsResult.status === 'fulfilled' ? postedJobsResult.value : [];
        const externalJobs = externalJobsResult.status === 'fulfilled' ? externalJobsResult.value : [];

        setAllJobs([...postedJobs, ...externalJobs]);

        if (userProfile?.role === 'candidate') {
          try {
            const token = await getToken();
            const allApps = await apiGetStoredApplications(token || undefined);
            const appliedIds = allApps
              .filter(app => app.candidateId === userProfile.uid)
              .map(app => app.jobId);
            setAppliedJobs(appliedIds);
          } catch { /* ignore; Supabase is optional for external job search */ }
        }
      } catch (error) {
        console.error("Error fetching jobs:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchJobsAndApps();
  }, [userProfile, debouncedSearch, category]);


  const confirmExternalApplication = async () => {
    if (!externalApplyModalJob || !userProfile) return;
    try {
      const newApp: Application = {
        id: 'app_' + Date.now().toString() + Math.random().toString(36).substring(2, 9),
        jobId: externalApplyModalJob.id,
        employerId: externalApplyModalJob.employerId,
        candidateId: userProfile.uid,
        candidateName: userProfile.name,
        candidateEmail: userProfile.email,
        appliedAt: Date.now(),
        status: 'pending',
        resumeUrl: ''
      };
      const token = await getToken();
      await apiAddApplication(newApp, token || undefined);
      setAppliedJobs([...appliedJobs, externalApplyModalJob.id]);
    } catch (error) {
      console.error("Error confirming apply:", error);
    } finally {
      setExternalApplyModalJob(null);
    }
  };

  const handleApply = async (job: Job) => {
    if (!userProfile) {
      setActivePage('join');
      return;
    }
    if (userProfile.role !== 'candidate') {
      alert("Only candidates can apply for jobs.");
      return;
    }

    if (!resumeFile && !job.isExternal) {
      alert("Please select a resume file to upload before applying.");
      fileInputRef.current?.click();
      return;
    }

    if (job.isExternal && job.externalUrl) {
      window.open(job.externalUrl, '_blank');
      setExternalApplyModalJob(job);
      return;
    }

    setApplyingTo(job.id);
    try {
      let resumeUrl = '';
      if (resumeFile) {
        // Convert resume to base64
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(resumeFile);
        });
        resumeUrl = fileData;
      }

      const newApp: Application = {
        id: 'app_' + Date.now().toString() + Math.random().toString(36).substring(2, 9),
        jobId: job.id,
        employerId: job.employerId,
        candidateId: userProfile.uid,
        candidateName: userProfile.name,
        candidateEmail: userProfile.email,
        appliedAt: Date.now(),
        status: 'pending',
        resumeUrl
      };
      const token = await getToken();
      await apiAddApplication(newApp, token || undefined);
      const pipelineToken = await getToken({ template: 'hirely-api' });
      void fetch('/api/pipeline/run', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pipelineToken}` }, body: JSON.stringify({ applicationId: newApp.id, resumeDataUrl: newApp.resumeUrl }) }).catch(error => console.warn('Pipeline could not be started:', error));
      setAppliedJobs([...appliedJobs, job.id]);

      if (resumeFile) {
        setResumeFile(null); // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      }

      alert("Application submitted successfully!");
    } catch (error) {
      console.error("Error applying:", error);
      alert("Failed to apply. Please try again.");
    } finally {
      setApplyingTo(null);
    }
  };

  // Filter by category only (server already handles search query filtering)
  const filteredJobs = category === 'All'
    ? allJobs
    : allJobs.filter(j => j.category === category);

  const categories = ['All', 'Engineering', 'Design', 'Marketing', 'Sales', 'Product'];

  return (
    <div className="pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        {externalApplyModalJob && (
          <ConfirmApplyModal
            job={externalApplyModalJob}
            onConfirm={confirmExternalApplication}
            onCancel={() => setExternalApplyModalJob(null)}
          />
        )}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-display font-bold text-slate-900 mb-4">Find your next challenge</h1>
          <p className="text-slate-500">Browse thousands of high-quality roles from innovative companies.</p>
        </div>

        {/* Search & Filter */}
        <div className="glass p-4 rounded-[2rem] mb-12 flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by role or company..."
              className="w-full pl-12 pr-4 py-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar items-center">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={cn(
                  "px-6 py-4 rounded-2xl font-bold text-sm whitespace-nowrap transition-all",
                  category === cat ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                )}
              >
                {cat}
              </button>
            ))}
            {userProfile?.role === 'candidate' && (
              <div className="ml-4 flex items-center gap-2 border-l border-slate-200 pl-4">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(e) => {
                    const file=e.target.files?.[0];
                    if(file && file.size>2_000_000){alert('Resume files must be 2 MB or smaller.');e.target.value='';setResumeFile(null);return;}
                    if(file && !/\.(pdf|docx|txt)$/i.test(file.name)){alert('Upload a PDF, DOCX, or TXT resume.');e.target.value='';setResumeFile(null);return;}
                    setResumeFile(file || null);
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-emerald-50 text-emerald-600 px-4 py-3 rounded-xl font-bold text-sm whitespace-nowrap hover:bg-emerald-100 transition-all flex items-center gap-2"
                >
                  {resumeFile ? 'Resume Selected' : 'Upload Resume'}
                </button>
                {resumeFile && <span className="text-xs text-slate-500 max-w-[100px] truncate">{resumeFile.name}</span>}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center">
            <p className="text-slate-500">Loading jobs...</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onApply={() => handleApply(job)}
                onViewDetails={() => setSelectedJob(job)}
                isApplying={applyingTo === job.id}
                hasApplied={appliedJobs.includes(job.id)}
              />
            ))}
          </div>
        )}

        {!loading && filteredJobs.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="text-slate-300 w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">No jobs found</h3>
            <p className="text-slate-500">Try adjusting your search or filters.</p>
          </div>
        )}

        {selectedJob && (
          <JobDetailsModal
            job={selectedJob}
            onClose={() => setSelectedJob(null)}
            onApply={() => handleApply(selectedJob)}
            isApplying={applyingTo === selectedJob.id}
            hasApplied={appliedJobs.includes(selectedJob.id)}
          />
        )}
      </div>
    </div>
  );
};

const CompaniesPage = ({ onCompanyClick }: { onCompanyClick: (name: string) => void }) => {
  return (
    <div className="pt-32 pb-20 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-20 text-center">
          <h1 className="text-5xl md:text-6xl font-display font-bold text-well-black mb-6 tracking-tight">Work with the best</h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto">Explore high-growth startups and their engineering cultures. Built for the world's most talented builders.</p>
        </div>
      </div>

      <CompanyMarquee onCompanyClick={onCompanyClick} />

      <div className="max-w-7xl mx-auto px-6 mt-20">
        <div className="grid gap-20">
          {companies.map((company) => (
            <motion.div
              key={company.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-white rounded-[3rem] border border-slate-100 overflow-hidden shadow-xl"
            >
              {/* Step 1 & 2: EVP & Cultural Proof Header */}
              <div className="relative h-96 lg:h-[500px]">
                <img
                  src={company.logo}
                  alt={company.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-well-black/90 via-well-black/40 to-transparent flex flex-col justify-end p-8 lg:p-16">
                  <div className="flex items-center gap-6 mb-6">
                    <div className="w-20 h-20 rounded-2xl bg-white p-1 shadow-2xl">
                      <img src={company.logo} className="w-full h-full object-contain rounded-xl" alt="mini logo" />
                    </div>
                    <div>
                      <h2 className="text-4xl lg:text-6xl font-bold text-white tracking-tight">{company.name}</h2>
                      <div className="flex gap-3 mt-3">
                        <span className="bg-well-red text-white text-xs font-black px-3 py-1 rounded-full uppercase tracking-widest">Hiring Now</span>
                        <span className="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-3 py-1 rounded-full">{company.industry}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 lg:p-16 grid lg:grid-cols-3 gap-16">
                <div className="lg:col-span-2 space-y-12">
                  {/* Step 1: Employee Value Proposition */}
                  <div>
                    <h3 className="text-sm font-black text-well-red uppercase tracking-[0.2em] mb-6">Employee Value Proposition</h3>
                    <p className="text-xl text-slate-600 leading-relaxed font-medium">
                      {company.description}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4 mt-8">
                      {['Flexible Work', 'Health & Wellness', 'Equity Options', 'Learning Budget'].map(benefit => (
                        <div key={benefit} className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className="w-8 h-8 rounded-full bg-well-red/10 flex items-center justify-center text-well-red">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                          <span className="font-bold text-slate-700">{benefit}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Step 3: Technical Environment */}
                  <div className="p-8 bg-well-black rounded-[2.5rem] text-white">
                    <h3 className="text-xs font-black text-well-red uppercase tracking-[0.2em] mb-6">Technical Environment</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
                      <div>
                        <p className="text-well-red text-xs font-black mb-2 uppercase">Stack</p>
                        <p className="font-bold text-lg">React, TS, Node.js</p>
                      </div>
                      <div>
                        <p className="text-well-red text-xs font-black mb-2 uppercase">Infrastructure</p>
                        <p className="font-bold text-lg">AWS, Kubernetes</p>
                      </div>
                      <div>
                        <p className="text-well-red text-xs font-black mb-2 uppercase">Methodology</p>
                        <p className="font-bold text-lg">CI/CD, Agile</p>
                      </div>
                    </div>
                  </div>

                  {/* Step 4: Social Proof */}
                  <div>
                    <h3 className="text-sm font-black text-well-red uppercase tracking-[0.2em] mb-6">Cultural Proof</h3>
                    <div className="bg-slate-50 p-8 rounded-[2.5rem] italic text-lg text-slate-600 border border-slate-100 relative">
                      <span className="absolute -top-4 -left-2 text-6xl text-well-red/20 font-serif">"</span>
                      "Working here has been the most transformative experience of my career. The speed of execution and the caliber of talent is unmatched anywhere else in the industry."
                      <div className="mt-6 flex items-center gap-4 not-italic">
                        <div className="w-12 h-12 rounded-full bg-slate-200 overflow-hidden">
                          <img src={`https://picsum.photos/seed/${company.id}ce/100/100`} className="w-full h-full object-cover" alt="avatar" />
                        </div>
                        <div>
                          <p className="font-bold text-well-black">Senior Software Engineer</p>
                          <p className="text-sm text-slate-500">Employee for 3+ years</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-12">
                  {/* Step 5: Growth Indicators */}
                  <div className="p-8 border border-slate-100 rounded-[2.5rem]">
                    <h3 className="text-xs font-black text-well-red uppercase tracking-[0.2em] mb-6">Growth Indicators</h3>
                    <div className="space-y-6">
                      {company.milestones.map((m, i) => (
                        <div key={i} className="flex gap-4">
                          <span className="font-bold text-well-red">{m.year}</span>
                          <p className="text-slate-700 font-medium">{m.event}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Step 6: DEI Commitment */}
                  <div className="p-8 border border-slate-100 rounded-[2.5rem] bg-well-red/5">
                    <h3 className="text-xs font-black text-well-red uppercase tracking-[0.2em] mb-4">DEI Commitment</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      We are committed to building a diverse community. Our Employee Resource Groups (ERGs) ensure everyone has a voice and a path to leadership.
                    </p>
                  </div>

                  {/* Step 7: Conversion Path */}
                  <div className="sticky top-32">
                    <button className="w-full bg-well-black text-white px-8 py-6 rounded-[2rem] font-bold text-xl hover:bg-black transition-all shadow-xl flex items-center justify-center gap-3">
                      View Open Roles <ArrowRight className="w-6 h-6" />
                    </button>
                    <p className="text-center text-sm text-slate-400 mt-4 font-medium">Capture immediate interest — 12 roles open</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

const JoinPage = () => {
  const [role, setRole] = useState<'candidate' | 'recruiter'>('candidate');
  const [isLogin, setIsLogin] = useState(false);

  useEffect(() => {
    localStorage.setItem('intendedRole', role);
  }, [role]);

  return (
    <div className="min-h-screen pt-32 pb-20 px-6 flex items-center justify-center bg-slate-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl shadow-slate-200 border border-slate-100 flex flex-col items-center">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-100">
              <Zap className="text-white w-8 h-8" />
            </div>
            <h1 className="text-3xl font-display font-bold text-slate-900 mb-2">
              {isLogin ? 'Welcome Back' : 'Join the Network'}
            </h1>
            <p className="text-slate-500">
              {isLogin
                ? (role === 'candidate' ? 'Log in to your talent portal' : 'Log in to your employer portal')
                : (role === 'candidate' ? 'Start your AI-powered career journey' : 'Find the perfect candidates with AI')}
            </p>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-2xl mb-8 w-full">
            <button
              type="button"
              onClick={() => setRole('candidate')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                role === 'candidate' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Candidate
            </button>
            <button
              type="button"
              onClick={() => setRole('recruiter')}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-bold transition-all",
                role === 'recruiter' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Recruiter
            </button>
          </div>

          <div className="w-full flex justify-center">
            {isLogin ? <SignIn routing="hash" /> : <SignUp routing="hash" />}
          </div>

          <div className="mt-8 pt-8 border-t border-slate-50 text-center w-full">
            <p className="text-slate-500 text-sm">
              {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-indigo-600 font-bold hover:underline"
              >
                {isLogin ? 'Sign Up' : 'Log In'}
              </button>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const JobSeekerDashboard = ({ userProfile, setActivePage }: { userProfile: UserProfile, setActivePage: (p: string) => void }) => {
  const { getToken } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [externalJobs, setExternalJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedChatApp, setSelectedChatApp] = useState<Application | null>(null);
  const [externalApplyModalJob, setExternalApplyModalJob] = useState<Job | null>(null);

  useEffect(() => {
    const fetchApps = async () => {
      try {
        const token = await getToken();
        const allApps = await apiGetStoredApplications(token || undefined);
        const myApps = allApps.filter(app => app.candidateId === userProfile.uid);
        setApplications(myApps);
      } catch (error) {
        console.error('Failed to load applications:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchApps();
  }, [userProfile.uid]);

  useEffect(() => {
    const getExternalJobs = async () => {
      try {
        // Fetch a diverse mix for the dashboard
        const jobs = await fetchExternalJobs('Software OR Marketing OR Design Jobs India');
        setExternalJobs(jobs.slice(0, 6)); // Show top 6
      } catch (error) {
        console.error("Error fetching external jobs:", error);
      } finally {
        setLoadingJobs(false);
      }
    };
    getExternalJobs();
  }, []);

  const handleApplyExternal = async (job: Job) => {
    if (job.externalUrl) {
      window.open(job.externalUrl, '_blank');
      setExternalApplyModalJob(job);
    }
  };

  const confirmExternalApplication = async () => {
    if (!externalApplyModalJob) return;
    try {
      const newApp: Application = {
        id: 'app_' + Date.now().toString() + Math.random().toString(36).substring(2, 9),
        jobId: externalApplyModalJob.id,
        employerId: externalApplyModalJob.employerId,
        candidateId: userProfile.uid,
        candidateName: userProfile.name,
        candidateEmail: userProfile.email,
        appliedAt: Date.now(),
        status: 'pending'
      };
      const token = await getToken();
      await apiAddApplication(newApp, token || undefined);
      setApplications([...applications, newApp]);
    } catch (error) {
      console.error("Error confirming apply:", error);
    } finally {
      setExternalApplyModalJob(null);
      setSelectedJob(null);
    }
  };

  return (
    <div className="pt-32 pb-20 px-6 min-h-[70vh]">
      <div className="max-w-7xl mx-auto">
        {externalApplyModalJob && (
          <ConfirmApplyModal
            job={externalApplyModalJob}
            onConfirm={confirmExternalApplication}
            onCancel={() => setExternalApplyModalJob(null)}
          />
        )}
        <div className="flex items-center gap-4 mb-12">
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center">
            <Users className="text-indigo-600 w-8 h-8" />
          </div>
          <div>
            <h1 className="text-4xl font-display font-bold text-slate-900">Welcome, {userProfile.name}</h1>
            <p className="text-slate-500">Candidate Dashboard</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-12">
          <div className="lg:col-span-1 space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                <h3 className="text-slate-500 font-medium mb-2 text-sm">Applications Sent</h3>
                <p className="text-3xl font-bold text-slate-900">{applications.length}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                <h3 className="text-slate-500 font-medium mb-2 text-sm">Interviews</h3>
                <p className="text-3xl font-bold text-slate-900">0</p>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Your Applications</h2>
              {loading ? (
                <p className="text-slate-500">Loading applications...</p>
              ) : applications.length === 0 ? (
                <div className="bg-slate-50 p-8 rounded-3xl text-center border border-slate-100">
                  <Briefcase className="w-10 h-10 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-bold text-slate-900 mb-2">No applications yet</h3>
                  <p className="text-slate-500 text-sm mb-6">Start applying to jobs to see them here.</p>
                  <button
                    onClick={() => setActivePage('jobs')}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all text-sm w-full"
                  >
                    Find Jobs
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {applications.map(app => (
                    <div key={app.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-slate-900 text-sm">Job ID: {app.jobId}</h3>
                          <p className="text-xs text-slate-500">Applied on {new Date(app.appliedAt).toLocaleDateString()}</p>
                        </div>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          app.status === 'pending' ? "bg-amber-50 text-amber-600" :
                            app.status === 'reviewed' ? "bg-blue-50 text-blue-600" :
                              app.status === 'accepted' ? "bg-emerald-50 text-emerald-600" :
                                app.status === 'on_hold' ? "bg-amber-50 text-amber-600" :
                                  "bg-rose-50 text-rose-600"
                        )}>
                          {app.status}
                        </span>
                      </div>
                      {app.status === 'accepted' && (
                        <div className="mt-2 pt-2 border-t border-slate-50 flex justify-end">
                          <button onClick={() => setSelectedChatApp(app)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100">Chat / Interview</button>
                        </div>
                      )}
                      <PipelineAssessment applicationId={app.id} jobId={app.jobId} resumeDataUrl={app.resumeUrl} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex justify-between items-end mb-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Recommended Opportunities</h2>
                <p className="text-slate-500 text-sm">External jobs curated for you</p>
              </div>
              <button
                onClick={() => setActivePage('jobs')}
                className="text-indigo-600 font-bold text-sm hover:text-indigo-700 transition-colors"
              >
                View All Jobs &rarr;
              </button>
            </div>

            {loadingJobs ? (
              <div className="py-12 text-center">
                <p className="text-slate-500">Fetching latest opportunities...</p>
              </div>
            ) : externalJobs.length === 0 ? (
              <div className="bg-slate-50 p-12 rounded-3xl text-center border border-slate-100">
                <Globe className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-slate-900 mb-2">No external jobs found</h3>
                <p className="text-slate-500 mb-6">Check back later for more opportunities.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-6">
                {externalJobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onApply={() => handleApplyExternal(job)}
                    onViewDetails={() => setSelectedJob(job)}
                    hasApplied={applications.some(app => app.jobId === job.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedJob && (
          <JobDetailsModal
            job={selectedJob}
            onClose={() => setSelectedJob(null)}
            onApply={() => handleApplyExternal(selectedJob)}
            hasApplied={applications.some(app => app.jobId === selectedJob.id)}
          />
        )}

        {selectedChatApp && (
          <ChatModal
            application={selectedChatApp}
            currentUser={userProfile}
            onClose={() => setSelectedChatApp(null)}
          />
        )}

        <AIVoiceInterview currentUser={userProfile} />
      </div>
    </div>
  );
};

const EmployerDashboard = ({ userProfile }: { userProfile: UserProfile }) => {
  const { getToken } = useAuth();
  const [employerJobs, setEmployerJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [newJob, setNewJob] = useState({ title: '', company: '', location: '', type: 'Full-time', salary: '', category: '', description: '', requiredCriteria: '', preferredCriteria: '' });
  const [jobDocFile, setJobDocFile] = useState<File | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [selectedChatApp, setSelectedChatApp] = useState<Application | null>(null);

  useEffect(() => {
    const fetchEmployerData = async () => {
      try {
        // Load employer jobs and applications from API
        const allJobs = await apiGetStoredJobs();
        const myJobs = allJobs.filter(job => job.employerId === userProfile.uid);
        setEmployerJobs(myJobs);

        const token = await getToken();
        const allApps = await apiGetStoredApplications(token || undefined);
        const myApps = allApps.filter(app => app.employerId === userProfile.uid);
        setApplications(myApps);
      } catch (error) {
        console.error('Failed to load employer data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchEmployerData();
  }, [userProfile.uid]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPublishing(true);
    try {
      let documentUrl = '';
      if (jobDocFile) {
        // Convert to base64
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(jobDocFile);
        });
        documentUrl = fileData;
      }

      const jobId = 'job_' + Date.now().toString() + Math.random().toString(36).substring(2, 9);
      const {requiredCriteria,preferredCriteria,...jobFields}=newJob;
      const criteriaList=(value:string)=>value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean).slice(0,80);
      const jobData: Job = {
        id: jobId,
        ...jobFields,
        requiredSkills:criteriaList(requiredCriteria),
        preferredSkills:criteriaList(preferredCriteria),
        employerId: userProfile.uid,
        postedAt: new Date().toLocaleDateString(),
        logo: 'https://picsum.photos/seed/company/100/100',
        documentUrl
      } as Job;

      await apiAddPostedJob(jobData);

      setEmployerJobs([...employerJobs, jobData]);
      setShowCreateJob(false);
      setNewJob({ title: '', company: '', location: '', type: 'Full-time', salary: '', category: '', description: '', requiredCriteria: '', preferredCriteria: '' });
      setJobDocFile(null);
    } catch (error) {
      console.error("Error creating job:", error);
      alert("Failed to create job.");
    } finally {
      setIsPublishing(false);
    }
  };

  const updateApplicationStatus = async (appId: string, newStatus: Application['status']) => {
    const token = await getToken();
    await apiUpdateApplicationStatus(appId, newStatus, token || undefined);
    setApplications(applications.map(app => app.id === appId ? { ...app, status: newStatus } : app));
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this job post?')) return;
    try {
      await apiDeletePostedJob(jobId);
      setEmployerJobs(employerJobs.filter(j => j.id !== jobId));
    } catch (error) {
      console.error("Failed to delete job:", error);
      alert("Failed to delete the job. Please try again.");
    }
  };

  return (
    <div className="pt-32 pb-20 px-6 min-h-[70vh]">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-end mb-12">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center">
              <Building2 className="text-emerald-600 w-8 h-8" />
            </div>
            <div>
              <h1 className="text-4xl font-display font-bold text-slate-900">Welcome, {userProfile.name}</h1>
              <p className="text-slate-500">Employer Dashboard</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateJob(!showCreateJob)}
            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            {showCreateJob ? 'Cancel' : 'Post New Job'}
          </button>
        </div>

        {showCreateJob && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-white p-8 rounded-3xl border border-slate-100 shadow-xl mb-12"
          >
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Create Job Post</h2>
            <form onSubmit={handleCreateJob} className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Job Title</label>
                <input required type="text" value={newJob.title} onChange={e => setNewJob({ ...newJob, title: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Company Name</label>
                <input required type="text" value={newJob.company} onChange={e => setNewJob({ ...newJob, company: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Location</label>
                <input required type="text" value={newJob.location} onChange={e => setNewJob({ ...newJob, location: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Salary Range</label>
                <input required type="text" value={newJob.salary} onChange={e => setNewJob({ ...newJob, salary: e.target.value })} placeholder="e.g. $100k - $120k" className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-2">Description</label>
                <textarea required value={newJob.description} onChange={e => setNewJob({ ...newJob, description: e.target.value })} rows={4} className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500"></textarea>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-2">Required criteria</label>
                <textarea value={newJob.requiredCriteria} onChange={e=>setNewJob({...newJob,requiredCriteria:e.target.value})} rows={3} placeholder="One criterion per line, for example: TypeScript, API design" className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
                <p className="mt-1 text-xs text-slate-500">Add explicit, job-related criteria for an evidence based assessment.</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-2">Preferred criteria</label>
                <textarea value={newJob.preferredCriteria} onChange={e=>setNewJob({...newJob,preferredCriteria:e.target.value})} rows={3} placeholder="One criterion per line" className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-2">Upload Job Profile / Specification Document (Optional)</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => setJobDocFile(e.target.files?.[0] || null)}
                  className="w-full p-3 bg-slate-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <button disabled={isPublishing} type="submit" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">
                  {isPublishing ? 'Publishing...' : 'Publish Job'}
                </button>
              </div>
            </form>
          </motion.div>
        )}

        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Your Active Jobs</h2>
            {loading ? <p className="text-slate-500">Loading...</p> : employerJobs.length === 0 ? (
              <p className="text-slate-500 bg-slate-50 p-6 rounded-2xl border border-slate-100">No jobs posted yet.</p>
            ) : (
              <div className="space-y-4">
                {employerJobs.map(job => (
                  <div key={job.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-slate-900 text-lg">{job.title}</h3>
                      <div className="flex gap-2">
                        {job.documentUrl && (
                          <a href={job.documentUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md hover:bg-indigo-100">
                            View Doc
                          </a>
                        )}
                        <button onClick={() => handleDeleteJob(job.id)} className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-md hover:bg-rose-100 transition-colors">
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="text-slate-500 text-sm mb-4">{job.location} • {job.salary}</p>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Posted {job.postedAt}</span>
                      <span className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full font-bold">
                        {applications.filter(a => a.jobId === job.id).length} Applicants
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}


          </div>

          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Recent Applicants</h2>
            {loading ? <p className="text-slate-500">Loading...</p> : applications.length === 0 ? (
              <p className="text-slate-500 bg-slate-50 p-6 rounded-2xl border border-slate-100">No applicants yet.</p>
            ) : (
              <div className="space-y-4">
                {applications.map(app => (
                  <div key={app.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-bold text-slate-900">{app.candidateName}</h3>
                        <p className="text-slate-500 text-sm">{app.candidateEmail}</p>
                      </div>
                      <span className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold uppercase",
                        app.status === 'accepted' ? "bg-emerald-50 text-emerald-600" :
                          app.status === 'rejected' ? "bg-rose-50 text-rose-600" :
                            app.status === 'on_hold' ? "bg-amber-50 text-amber-600" :
                              "bg-indigo-50 text-indigo-600"
                      )}>
                        {app.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-4">
                      <p className="text-sm text-slate-400">Applied for Job ID: {app.jobId}</p>
                      {app.resumeUrl && (
                        <button
                          onClick={() => downloadBase64File(app.resumeUrl!, `Resume_${app.candidateName.replace(/\s+/g, '_')}.pdf`)}
                          className="text-xs font-bold text-indigo-600 hover:underline bg-transparent border-none p-0 cursor-pointer"
                        >
                          View Resume
                        </button>
                      )}
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-50 flex flex-wrap gap-2">
                      <button onClick={() => updateApplicationStatus(app.id, 'accepted')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100">Accept</button>
                      <button onClick={() => updateApplicationStatus(app.id, 'rejected')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">Reject</button>
                      <button onClick={() => updateApplicationStatus(app.id, 'on_hold')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100">On Hold</button>
                      {app.status === 'accepted' && (
                        <button onClick={() => setSelectedChatApp(app)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ml-auto">Chat / Interview</button>
                      )}
                    </div>
                    <PipelineAssessment applicationId={app.id} jobId={app.jobId} recruiter />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedChatApp && (
          <ChatModal
            application={selectedChatApp}
            currentUser={userProfile}
            onClose={() => setSelectedChatApp(null)}
          />
        )}
      </div>
    </div >
  );
};

const DashboardPage = ({ setActivePage, userProfile }: { setActivePage: (p: string) => void, userProfile: UserProfile | null }) => {
  if (!userProfile) {
    return (
      <div className="pt-32 pb-20 px-6 min-h-[70vh] flex items-center justify-center">
        <p className="text-slate-500">Loading profile...</p>
      </div>
    );
  }

  if (userProfile.role === 'recruiter') {
    return <EmployerDashboard userProfile={userProfile} />;
  }

  return <JobSeekerDashboard userProfile={userProfile} setActivePage={setActivePage} />;
};

const Footer = ({ setActivePage }: { setActivePage: (p: string) => void }) => (
  <footer className="bg-slate-900 text-white py-20 px-6">
    <div className="max-w-7xl mx-auto">
      <div className="grid md:grid-cols-4 gap-12 mb-16">
        <div className="col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Zap className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-display font-bold tracking-tight">Hirely</span>
          </div>
          <p className="text-slate-400 max-w-sm mb-8">
            The world's most advanced AI-powered job portal. Connecting top talent with innovative companies through neural matching.
          </p>
          <div className="flex gap-4">
            {['Twitter', 'LinkedIn', 'Instagram'].map(s => (
              <a key={s} href="#" className="text-slate-400 hover:text-well-red transition-colors text-sm font-bold">{s}</a>
            ))}
          </div>
        </div>
        <div>
          <h4 className="font-bold mb-6">Platform</h4>
          <ul className="space-y-4 text-slate-400">
            <li><button onClick={() => setActivePage('jobs')} className="hover:text-well-red transition-colors">Find Jobs</button></li>
            <li><button onClick={() => setActivePage('companies')} className="hover:text-well-red transition-colors">Companies</button></li>
            <li><button onClick={() => setActivePage('join')} className="hover:text-well-red transition-colors">Talent Network</button></li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold mb-6">Company</h4>
          <ul className="space-y-4 text-slate-400">
            <li><button onClick={() => setActivePage('privacy')} className="hover:text-well-red transition-colors">Privacy Policy</button></li>
            <li><button onClick={() => setActivePage('contact')} className="hover:text-well-red transition-colors">Contact</button></li>
          </ul>
        </div>
      </div>
      <div className="pt-8 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500 text-sm">
        <p>© 2026 Hirely Inc. All rights reserved.</p>
        <p>Built with precision for the future of work.</p>
      </div>
    </div>
  </footer>
);

const ResumeBuilderPage = () => {
  const [template, setTemplate] = useState('minimalist');
  const [generating, setGenerating] = useState(false);

  const generateAI = () => {
    setGenerating(true);
    setTimeout(() => setGenerating(false), 2000);
  };

  return (
    <div className="pt-32 pb-20 px-6 min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-display font-bold text-well-black mb-6">AI Resume Builder</h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto">Build a professional, ATS-optimized resume in minutes with our AI-guided builder.</p>
        </div>
        <div className="grid lg:grid-cols-2 gap-12">
          <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-slate-100 min-h-[600px]">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-2xl font-bold">Personal Details</h2>
              <button
                onClick={generateAI}
                className={cn(
                  "px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-bold transition-all",
                  generating ? "animate-pulse" : "hover:bg-indigo-600 hover:text-white"
                )}
              >
                {generating ? 'Improving...' : 'Auto-Improve with AI'}
              </button>
            </div>
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-400 uppercase tracking-widest">Full Name</label>
                  <input type="text" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-600" placeholder="John Doe" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-400 uppercase tracking-widest">Email</label>
                  <input type="email" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-600" placeholder="john@example.com" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-400 uppercase tracking-widest">Professional Summary</label>
                <textarea rows={4} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-600" placeholder="Write about your career goals..."></textarea>
              </div>
              <div className="pt-6 border-t border-slate-50">
                <h3 className="font-bold mb-4">Experience</h3>
                <button className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold hover:border-indigo-600 hover:text-indigo-600 transition-all">
                  + Add Experience
                </button>
              </div>
            </div>
          </div>
          <div className="h-full">
            <div className="sticky top-32 space-y-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-400 uppercase tracking-widest text-sm">Design & Templates</h3>
                <div className="flex gap-2">
                  {['Modern', 'Minimalist', 'Classic'].map(t => (
                    <button
                      key={t}
                      onClick={() => setTemplate(t.toLowerCase())}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all",
                        template === t.toLowerCase() ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-white border border-slate-100 text-slate-600 hover:shadow-md"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className={cn(
                "aspect-[1/1.4] bg-white shadow-2xl rounded-sm border border-slate-100 p-12 overflow-hidden flex flex-col gap-6 transition-all duration-500",
                template === 'minimalist' ? "items-center text-center" : "items-start"
              )}>
                <div className={cn("bg-slate-100 rounded-lg transition-all duration-500", template === 'minimalist' ? "w-2/3 h-12 mb-4" : "w-1/2 h-10")}></div>
                <div className="w-full h-4 bg-slate-50 rounded-lg"></div>
                <div className="w-full h-4 bg-slate-50 rounded-lg"></div>
                <div className="w-2/3 h-4 bg-slate-50 rounded-lg"></div>
                <div className="mt-8 space-y-4 w-full text-left">
                  <div className="w-1/3 h-6 bg-slate-100 rounded-lg"></div>
                  <div className="w-full h-24 bg-slate-50 rounded-lg border-l-2 border-indigo-600 pl-4"></div>
                  <div className="w-full h-24 bg-slate-50 rounded-lg border-l-2 border-emerald-600 pl-4"></div>
                </div>
              </div>
              <button className="w-full py-6 bg-well-black text-white rounded-[2rem] font-black text-xl hover:bg-black transition-all shadow-xl flex items-center justify-center gap-3">
                Export PDF <ArrowRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ResumeCheckerPage = () => {
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const analyzeResume = () => {
    setAnalyzing(true);
    setResult(null);
    setTimeout(() => {
      setAnalyzing(false);
      setResult({
        score: 84,
        summary: "Your profile shows strong mastery of React and TypeScript. However, your project section lacks impact metrics (qualifiable results).",
        tips: [
          "Quantify your impact: Use numbers like 'increased speed by 40%'",
          "Add more industry keywords: CI/CD, GraphQL, Unit Testing",
          "Improve layout: Your current template is slightly outdated."
        ]
      });
    }, 2500);
  };

  return (
    <div className="pt-32 pb-20 px-6 min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-display font-bold text-well-black mb-6">AI Resume Checker</h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto">Upload your resume to see an evidence-based assessment and constructive interview feedback for human review.</p>
        </div>

        <div className="grid gap-8">
          <div
            onClick={analyzeResume}
            className={cn(
              "bg-white rounded-[3rem] p-12 border-2 border-dashed transition-all text-center cursor-pointer group",
              analyzing ? "border-indigo-600 pointer-events-none" : "border-slate-200 hover:border-indigo-400"
            )}
          >
            <div className={cn(
              "w-20 h-20 bg-indigo-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 transition-all",
              analyzing ? "animate-pulse scale-110" : "group-hover:scale-110"
            )}>
              <Upload className="text-indigo-600 w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {analyzing ? 'Analyzing your profile...' : 'Drop your resume here'}
            </h2>
            <p className="text-slate-500 font-medium">Supports PDF, DOCX (Max 5MB)</p>
            {!analyzing && <button className="mt-8 px-8 py-4 bg-well-black text-white rounded-2xl font-bold hover:bg-black transition-all">Select File</button>}
          </div>

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-[3rem] p-12 border border-slate-100 shadow-xl"
            >
              <div className="flex justify-between items-center mb-12">
                <div>
                  <h3 className="text-3xl font-black text-well-black tracking-tight">ATS Score: {result.score}</h3>
                  <p className="text-slate-400 font-bold uppercase text-xs tracking-widest mt-2">Score potential: 100%</p>
                </div>
                <div className="w-24 h-24 rounded-full border-8 border-emerald-500 flex items-center justify-center font-black text-2xl text-emerald-600">
                  {result.score}%
                </div>
              </div>
              <div className="space-y-8">
                <div>
                  <h4 className="font-bold text-well-red mb-3 flex items-center gap-2 underline decoration-well-red/30 uppercase tracking-widest text-sm">AI Impact Summary</h4>
                  <p className="text-slate-600 leading-relaxed font-medium">{result.summary}</p>
                </div>
                <div className="grid md:grid-cols-2 gap-8 pt-8 border-t border-slate-50">
                  <div>
                    <h4 className="font-bold text-indigo-600 mb-4 tracking-tighter text-lg">Top Recommendations</h4>
                    <div className="space-y-3">
                      {result.tips.map((tip: string) => (
                        <div key={tip} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-slate-700 font-bold text-sm flex items-start gap-3">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          {tip}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-violet-600 mb-4 tracking-tighter text-lg">Recommended Templates</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-4 bg-violet-50 rounded-2xl border border-violet-100 text-center">
                        <div className="aspect-[1/1.4] bg-white rounded shadow-sm mb-3"></div>
                        <span className="text-xs font-bold text-violet-700">Minimal Pro</span>
                      </div>
                      <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-center">
                        <div className="aspect-[1/1.4] bg-white rounded shadow-sm mb-3"></div>
                        <span className="text-xs font-bold text-emerald-700">Executive</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

const CompanyProfilePage = ({ companyName, setActivePage }: { companyName: string, setActivePage: (p: string) => void }) => {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="pt-32 pb-20 px-6 min-h-screen bg-white">
      <div className="max-w-7xl mx-auto">
        {/* Header Section (EVP) */}
        <div className="flex flex-col md:flex-row gap-12 items-start mb-20">
          <div className="w-32 h-32 bg-[#1a1122] rounded-[2.5rem] flex items-center justify-center text-white shrink-0 shadow-2xl">
            <Zap className="w-16 h-16" />
          </div>
          <div className="flex-grow pt-4">
            <div className="flex items-center gap-4 mb-4">
              <h1 className="text-6xl font-black text-well-black tracking-tight uppercase">{companyName}</h1>
              <span className="px-4 py-1.5 bg-well-red/5 text-well-red rounded-full text-xs font-black uppercase tracking-widest border border-well-red/20 shadow-sm">Scale Up</span>
            </div>
            <p className="text-xl text-slate-500 max-w-2xl font-medium leading-relaxed mb-8">
              Revolutionizing the global financial infrastructure through code. We're building the future of money, one commit at a time.
            </p>
            <div className="flex flex-wrap gap-8 py-8 border-t border-slate-100">
              <div>
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Work Model</span>
                <span className="text-well-black font-bold">Remote-First / Hybrid</span>
              </div>
              <div>
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Funding</span>
                <span className="text-well-black font-bold">$2.4B Series G</span>
              </div>
              <div>
                <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Team Size</span>
                <span className="text-well-black font-bold">4,500+ Globally</span>
              </div>
              <button onClick={() => setActivePage('jobs')} className="ml-auto bg-well-black text-white px-8 py-4 rounded-2xl font-bold hover:bg-black transition-all shadow-xl">
                View Open Roles
              </button>
            </div>
          </div>
        </div>

        {/* 7-Step Framework Navigation */}
        <div className="flex gap-12 border-b border-slate-100 mb-16 overflow-x-auto no-scrollbar">
          {['overview', 'culture', 'tech-stack', 'benefits', 'careers'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "pb-6 text-sm font-black uppercase tracking-[0.2em] transition-all relative",
                activeTab === tab ? "text-well-red" : "text-slate-400 hover:text-well-black"
              )}
            >
              {tab}
              {activeTab === tab && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-1 bg-well-red" />}
            </button>
          ))}
        </div>

        {/* Content Section */}
        <div className="grid md:grid-cols-3 gap-16">
          <div className="md:col-span-2 space-y-20">
            {/* Step 2: Cultural Proof / Media */}
            <section id="culture" className="space-y-8">
              <h2 className="text-4xl font-black text-well-black tracking-tighter">Beyond the Screen</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="aspect-video bg-slate-100 rounded-[2rem] overflow-hidden group">
                  <div className="w-full h-full bg-[url('https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center group-hover:scale-110 transition-transform duration-700" />
                </div>
                <div className="aspect-square bg-slate-100 rounded-[2rem] overflow-hidden group">
                  <div className="w-full h-full bg-[url('https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2069&auto=format&fit=crop')] bg-cover bg-center group-hover:scale-110 transition-transform duration-700" />
                </div>
              </div>
              <p className="text-lg text-slate-600 leading-relaxed font-medium">
                Our culture is rooted in ownership and autonomy. We don't just ship products; we ship excellence. From our annual engineering off-sites to monthly deep-dive hackathons, we foster an environment where curiosity is rewarded and failure is viewed as a stepping stone to innovation.
              </p>
            </section>

            {/* Step 3: Tech Stack */}
            <section id="tech-stack" className="p-12 bg-well-black rounded-[3rem] text-white">
              <h2 className="text-3xl font-black mb-10 tracking-tight">The Engine Room</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                {[
                  { label: 'Language', val: 'Rust / Go' },
                  { label: 'Frontend', val: 'React / Next.js' },
                  { label: 'Database', val: 'PostgreSQL' },
                  { label: 'Infra', val: 'AWS / K8s' }
                ].map((tech) => (
                  <div key={tech.label}>
                    <span className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-1">{tech.label}</span>
                    <span className="font-bold text-lg">{tech.val}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Step 4: Social Proof / Testimonials */}
            <section className="space-y-12">
              <div className="p-12 border-l-4 border-well-red bg-slate-50 rounded-r-[3rem] relative">
                <span className="absolute -top-6 left-12 text-8xl font-serif text-well-red/10 overflow-hidden leading-none">“</span>
                <p className="text-2xl font-serif italic text-well-black mb-8 leading-relaxed">
                  "Joining {companyName} was the best career move I've made. The complexity of the problems we solve and the caliber of people I work with are unmatched in the industry."
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center font-black text-indigo-600">JS</div>
                  <div>
                    <span className="block font-black text-well-black">Jane Smith</span>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">VP Engineering</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-12">
            {/* Step 5: Careers / Path */}
            <div className="p-10 border border-slate-100 rounded-[2.5rem] shadow-sm">
              <h3 className="text-xl font-black text-well-black mb-6 tracking-tight">Career Acceleration</h3>
              <div className="space-y-6">
                {[
                  { step: '1', title: 'Onboarding', desc: 'Intensive 2-week tech immersion' },
                  { step: '2', title: 'Ownership', desc: 'Lead a major feature within 3 months' },
                  { step: '3', title: 'Growth', desc: 'Personal growth budget of $5k/year' }
                ].map((p) => (
                  <div key={p.step} className="flex gap-4">
                    <span className="w-8 h-8 rounded-full bg-well-red/10 text-well-red flex items-center justify-center text-xs font-black shrink-0">{p.step}</span>
                    <div>
                      <span className="block font-bold text-well-black">{p.title}</span>
                      <span className="text-sm text-slate-500 font-medium">{p.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 7: News / Dynamic */}
            <div className="space-y-6">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Latest Updates</h3>
              <div className="p-6 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all cursor-pointer">
                <span className="text-[10px] font-black text-well-red uppercase tracking-widest mb-2 block">Engineering Blog</span>
                <p className="font-bold text-well-black group-hover:text-well-red">Scaling our distributed ledger to 100M TPS</p>
              </div>
              <div className="p-6 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all cursor-pointer">
                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2 block">Press Release</span>
                <p className="font-bold text-well-black">Expansion into the SE Asian Market</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CoverLetterPage = () => {
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState('');

  const generate = () => {
    setGenerating(true);
    setContent('');
    setTimeout(() => {
      setGenerating(false);
      setContent("Dear Hiring Team,\n\nI am writing to express my strong interest in the role as advertised. With my extensive experience in developing high-performance web applications using React and Node.js, I am confident that I can contribute significantly to your engineering team. I have a proven track record of delivering scalable solutions and optimizing front-end performance...");
    }, 2000);
  };

  return (
    <div className="pt-32 pb-20 px-6 min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-display font-bold text-well-black mb-6">AI Cover Letter Generator</h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto">Stand out with a tailored cover letter written by AI in seconds.</p>
        </div>

        <div className="grid gap-8">
          <div className="bg-white rounded-[3rem] p-12 shadow-xl border border-slate-100">
            <div className="space-y-8">
              <div className="space-y-4">
                <label className="text-sm font-black text-slate-400 uppercase tracking-widest">Job Description</label>
                <textarea rows={6} className="w-full px-8 py-6 bg-slate-50 border-none rounded-[2rem] focus:ring-2 focus:ring-indigo-600 resize-none font-medium" placeholder="Paste the job description here..."></textarea>
              </div>
              <div className="space-y-4">
                <label className="text-sm font-black text-slate-400 uppercase tracking-widest">Your Experience (Key Highlights)</label>
                <textarea rows={4} className="w-full px-8 py-6 bg-slate-50 border-none rounded-[2rem] focus:ring-2 focus:ring-indigo-600 resize-none font-medium" placeholder="What parts of your experience should we emphasize?"></textarea>
              </div>
              <button
                onClick={generate}
                disabled={generating}
                className="w-full py-6 bg-well-black text-white rounded-[2rem] font-bold text-xl hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl disabled:opacity-50"
              >
                {generating ? 'Generating your letter...' : 'Write my cover letter'} <Zap className="w-6 h-6 fill-current text-amber-400" />
              </button>
            </div>
          </div>

          {content && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-[3rem] p-12 border-2 border-slate-100 shadow-2xl relative"
            >
              <div className="absolute top-8 right-12 flex gap-4">
                <button className="text-xs font-bold text-indigo-600 hover:underline">Copy text</button>
                <button className="text-xs font-bold text-indigo-600 hover:underline">Download PDF</button>
              </div>
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.2em] mb-8">Generated Result</h3>
              <div className="prose prose-slate max-w-none">
                <p className="whitespace-pre-line text-slate-700 leading-relaxed text-lg font-medium">{content}</p>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

const PrivacyPolicyPage = () => (
  <div className="pt-32 pb-20 px-6 min-h-[70vh] max-w-4xl mx-auto">
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
      <h1 className="text-4xl font-display font-bold text-slate-900 mb-8">Privacy Policy</h1>
      <div className="prose prose-slate max-w-none text-slate-600 space-y-6">
        <p className="font-medium text-slate-500">Last updated: February 2026</p>
        <h2 className="text-2xl font-bold text-slate-900 mt-8 mb-4">1. Information We Collect</h2>
        <p>We collect information you provide directly to us, including when you create an account, update your profile, apply for jobs, or communicate with us. This may include your name, email address, resume, work history, and other professional details.</p>
        <h2 className="text-2xl font-bold text-slate-900 mt-8 mb-4">2. How We Use Your Information</h2>
        <p>We use the information we collect to operate, maintain, and improve our services, match candidates with suitable job opportunities, and enable communication between recruiters and candidates. Oh, and to train our AI models for neural matching.</p>
        <h2 className="text-2xl font-bold text-slate-900 mt-8 mb-4">3. Information Sharing</h2>
        <p>When you apply for a job, your profile information and resume are shared with the respective employer. We do not sell your personal data to third parties.</p>
        <h2 className="text-2xl font-bold text-slate-900 mt-8 mb-4">4. Data Security</h2>
        <p>We implement appropriate technical and organizational measures designed to protect the security of any personal information we process. However, despite our safeguards, no internet transmission is completely secure.</p>
        <div className="mt-8 p-6 bg-slate-50 rounded-2xl border border-slate-200">
          <p className="text-sm text-slate-500 italic">By using Hirely, you agree to these terms. This is a professional agreement establishing our commitment to transparent and secure data practices.</p>
        </div>
      </div>
    </motion.div>
  </div>
);

const ContactPage = () => (
  <div className="pt-32 pb-20 px-6 min-h-[70vh] max-w-4xl mx-auto">
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
      <h1 className="text-4xl font-display font-bold text-slate-900 mb-8">Contact Us</h1>
      <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-slate-100">
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Get in Touch</h2>
            <p className="text-slate-600 mb-8">Have questions about our AI-powered portal? Looking to partner with us? Our team is here to help.</p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Address</h3>
                  <p className="text-slate-600">VIT Vellore<br />Katpadi, Tamil Nadu<br />632014</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Our Team</h2>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center shrink-0 font-bold text-sm">MK</div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Manan Kothari</h3>
                  <a href="mailto:manankothari69@gmail.com" className="text-emerald-600 hover:underline text-sm break-all">manankothari69@gmail.com</a>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center shrink-0 font-bold text-sm">AM</div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Aman</h3>
                  <a href="mailto:aman.2023@vitstudent.ac.in" className="text-rose-600 hover:underline text-sm break-all">aman.2023@vitstudent.ac.in</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  </div>
);

export default function App() {
  const [activePage, setActivePage] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const { user, isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);

  const handleCompanyClick = (name: string) => {
    setSelectedCompany(name);
    setActivePage('company-profile');
  };

  useEffect(() => {
    const fetchProfile = async () => {
      if (isLoaded) {
        if (isSignedIn && user) {
          setCheckingProfile(true);
          try {
          const existingProfile = await apiGetStoredProfile(user.id);
          const requestedRole = (localStorage.getItem('intendedRole') as 'candidate' | 'recruiter') || existingProfile?.role || 'candidate';
          const token = await getToken();
          const roleResponse = await fetch('/api/auth/role', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify({role:requestedRole}) });
          if (!roleResponse.ok) throw new Error('Could not load your account role');
          const roleData = await roleResponse.json();
          const role: 'candidate'|'recruiter' = roleData.role;
          // Clerk public metadata is the authoritative role; keep the portal profile in sync.
          if (existingProfile) {
            const profile = { ...existingProfile, role };
            if (existingProfile.role !== role) await apiSaveProfile(profile);
            setUserProfile(profile);
            localStorage.removeItem('intendedRole');
          } else {
            const newProfile: UserProfile = {
              uid: user.id,
              email: user.primaryEmailAddress?.emailAddress || '',
              name: user.fullName || user.primaryEmailAddress?.emailAddress?.split('@')[0] || 'User',
              role
            };
            await apiSaveProfile(newProfile);
            setUserProfile(newProfile);
            localStorage.removeItem('intendedRole');
          }
          } catch (error) {
            console.error('Account setup could not be completed:', error instanceof Error ? error.name : 'Error');
            setUserProfile(null);
          } finally {
            setCheckingProfile(false);
          }
        } else {
          setUserProfile(null);
          setCheckingProfile(false);
        }
      }
    };
    fetchProfile();
  }, [isSignedIn, user?.id, isLoaded, getToken]);

  // Scroll to top on page change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activePage, selectedCompany]);

  // Auto-redirect to dashboard after sign-in
  useEffect(() => {
    if (isLoaded && isSignedIn && activePage === 'join') {
      setActivePage('dashboard');
    }
  }, [isLoaded, isSignedIn, activePage]);

  if (isLoaded && isSignedIn && checkingProfile && !userProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 font-medium">Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col selection:bg-indigo-100 selection:text-indigo-900">
      <Navbar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-grow">
        <AnimatePresence mode="wait">
          <motion.div
            key={activePage + (activePage === 'company-profile' ? selectedCompany : '')}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {activePage === 'home' && <HomePage setActivePage={setActivePage} setSearchQuery={setSearchQuery} onCompanyClick={handleCompanyClick} />}
            {activePage === 'jobs' && <JobsPage userProfile={userProfile} setActivePage={setActivePage} initialSearch={searchQuery} />}
            {activePage === 'resume-builder' && <ResumeBuilderPage />}
            {activePage === 'resume-checker' && <ResumeCheckerPage />}
            {activePage === 'cover-letter' && <CoverLetterPage />}
            {activePage === 'company-profile' && <CompanyProfilePage companyName={selectedCompany} setActivePage={setActivePage} />}
            {activePage === 'join' && <JoinPage />}
            {activePage === 'dashboard' && <DashboardPage setActivePage={setActivePage} userProfile={userProfile} />}
            {activePage === 'privacy' && <PrivacyPolicyPage />}
            {activePage === 'contact' && <ContactPage />}
          </motion.div>
        </AnimatePresence>
      </main>

      <Footer setActivePage={setActivePage} />
      {isSignedIn && <Chatbot />}
    </div>
  );
}

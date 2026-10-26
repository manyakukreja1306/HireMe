import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Send, UserCircle, Mail, Sparkles, Loader2, Copy, CheckCircle2 } from 'lucide-react';
import { UserProfile } from '../types';

export const AIHeadhunter = ({ currentUser }: { currentUser: UserProfile }) => {
    const [prompt, setPrompt] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<any[] | null>(null);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim()) return;

        setIsSearching(true);
        setResults(null);

        try {
            // 1. Fetch all candidate profiles
            const profilesRes = await fetch('/api/db/profiles');
            const allProfiles: UserProfile[] = await profilesRes.json();
            const candidates = allProfiles.filter(p => p.role === 'candidate');

            if (candidates.length === 0) {
                setResults([]);
                setIsSearching(false);
                return;
            }

            // 2. Prepare the AI Prompt
            const candidateListStr = candidates.map(c =>
                `ID: ${c.uid}, Name: ${c.name}, Email: ${c.email}, Skills/Experience: (Simulated standard profile data)`
            ).join('\n');

            const systemPrompt = `
You are an expert AI Tech Recruiter. The employer is looking for candidates based on this prompt: "${prompt}".
Here is the list of available candidates in our database:
${candidateListStr}

Your task is to:
1. Identify the top 1-3 candidates that best match the employer's request. (If none perfectly match, pick the closest ones and explain why).
2. For each matched candidate, write a highly personalized, compelling outreach email drafted from the employer to the candidate. Keep it professional but engaging.

Return the result STRICTLY as a JSON array of objects with this format:
[
  {
    "uid": "candidate_uid",
    "name": "Candidate Name",
    "matchReason": "Why they are a good fit in 1 sentence.",
    "draftEmail": "The full drafted email body."
  }
]
No markdown formatting or extra text outside the JSON array. Return empty array if zero matches.`;

            // 3. Call the generic Chat API endpoint
            const aiRes = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: systemPrompt })
            });

            const aiData = await aiRes.json();

            let parsedResults = [];
            try {
                // Strip markdown backticks if the AI accidentally adds them
                const cleanedResponse = aiData.reply.replace(/```json/g, '').replace(/```/g, '').trim();
                parsedResults = JSON.parse(cleanedResponse);
            } catch (parseError) {
                console.error("Failed to parse AI response:", aiData.reply);
                parsedResults = [];
            }

            setResults(parsedResults);

        } catch (error) {
            console.error("Headhunter Error:", error);
            alert("AI Sourcing failed. Please check the console.");
        } finally {
            setIsSearching(false);
        }
    };

    const copyToClipboard = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    return (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden">
            <div className="p-8 md:p-12 bg-indigo-50/50">
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                        <Sparkles className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">AI Headhunter</h2>
                        <p className="text-slate-500 font-medium text-sm">Autonomous candidate sourcing & outreach</p>
                    </div>
                </div>

                <form onSubmit={handleSearch} className="mt-8 relative">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={isSearching}
                        placeholder="e.g., Find me 2 frontend developers who know React and have an eye for design..."
                        className="w-full bg-white border-2 border-indigo-100 rounded-3xl p-6 pr-20 text-slate-700 font-medium placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all resize-none min-h-[120px]"
                    />
                    <button
                        type="submit"
                        disabled={isSearching || !prompt.trim()}
                        className="absolute bottom-6 right-6 p-4 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-200"
                    >
                        {isSearching ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
                    </button>
                </form>
            </div>

            {results && (
                <div className="p-8 md:p-12 border-t border-slate-100">
                    <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-2">
                        Sourcing Results <span className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded-full">{results.length} found</span>
                    </h3>

                    {results.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 rounded-3xl border border-slate-100">
                            <p className="text-slate-500 font-medium">No candidates matched your criteria directly. Try broadening your search.</p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {results.map((candidate, idx) => (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.1 }}
                                    key={idx}
                                    className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"
                                >
                                    <div className="p-6 bg-slate-50/80 border-b border-slate-100 flex items-start gap-4">
                                        <UserCircle className="w-12 h-12 text-slate-400" />
                                        <div>
                                            <h4 className="text-lg font-bold text-slate-900">{candidate.name}</h4>
                                            <p className="text-sm font-medium text-indigo-600 mt-1 flex items-start gap-2">
                                                <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                                                {candidate.matchReason}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="p-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                <Mail className="w-4 h-4" /> AI Drafted Outreach
                                            </span>
                                            <button
                                                onClick={() => copyToClipboard(candidate.draftEmail, idx)}
                                                className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-2"
                                            >
                                                {copiedIndex === idx ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Email</>}
                                            </button>
                                        </div>
                                        <div className="p-6 bg-slate-50 rounded-2xl text-slate-700 text-sm whitespace-pre-wrap font-medium leading-relaxed border border-slate-100">
                                            {candidate.draftEmail}
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

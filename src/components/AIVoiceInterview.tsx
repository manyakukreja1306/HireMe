import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Square, Loader2, Volume2, VolumeX, BrainCircuit, Bot, User, AlertCircle, RotateCcw, ChevronDown } from 'lucide-react';
import { UserProfile } from '../types';

declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

interface ChatMessage {
    role: 'ai' | 'candidate';
    text: string;
}

type InterviewMode = 'hr' | 'technical' | 'behavioral' | 'resume';

const MODE_LABELS: Record<InterviewMode, { label: string; emoji: string; desc: string }> = {
    hr: { label: 'HR Round', emoji: '🤝', desc: 'Culture fit, goals & motivation' },
    technical: { label: 'Technical Round', emoji: '💻', desc: 'DSA, system design & coding' },
    behavioral: { label: 'Behavioral Round', emoji: '🧠', desc: 'STAR method, situational Qs' },
    resume: { label: 'Resume Discussion', emoji: '📄', desc: 'Experience walkthrough' },
};

// ── TTS Helper ──
function speakText(text: string): Promise<void> {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(); return; }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.97;
        utter.pitch = 1;
        utter.lang = 'en-US';
        const voices = window.speechSynthesis.getVoices();
        const pick = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || voices.find(v => v.lang.startsWith('en'));
        if (pick) utter.voice = pick;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
    });
}

function stopSpeaking() {
    window.speechSynthesis?.cancel();
}

export const AIVoiceInterview = ({ currentUser, onClose }: { currentUser: UserProfile; onClose?: () => void }) => {
    // ── State ──
    const [phase, setPhase] = useState<'idle' | 'speaking' | 'listening' | 'processing'>('idle');
    const [mode, setMode] = useState<InterviewMode>('technical');
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [liveTranscript, setLiveTranscript] = useState('');
    const [hasSpeechAPI, setHasSpeechAPI] = useState(true);
    const [showModeMenu, setShowModeMenu] = useState(false);
    const [isSpeechMuted, setIsSpeechMuted] = useState(false);

    const recognitionRef = useRef<any>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const isProcessingRef = useRef(false); // prevent duplicate calls

    // Auto-scroll
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory, liveTranscript]);

    // Setup SpeechRecognition
    useEffect(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { setHasSpeechAPI(false); return; }
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (e: any) => {
            let interim = '';
            let final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) final += t;
                else interim += t;
            }
            if (final) setLiveTranscript(prev => (prev + ' ' + final).trim());
            // Show interim for live preview (optional – can be shown separately)
        };

        rec.onerror = (e: any) => {
            if (e.error !== 'aborted') console.error('Speech error:', e.error);
        };

        rec.onend = () => {
            // Do nothing; we control restart manually
        };

        recognitionRef.current = rec;
        return () => { rec.stop(); stopSpeaking(); };
    }, []);

    // Load voices
    useEffect(() => {
        window.speechSynthesis?.getVoices();
        const handler = () => window.speechSynthesis?.getVoices();
        window.speechSynthesis?.addEventListener?.('voiceschanged', handler);
        return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', handler);
    }, []);

    // ── Send message to backend ──
    const sendToAI = useCallback(async (userText: string, history: ChatMessage[]): Promise<string> => {
        const res = await fetch('/api/voice-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userText, mode, history }),
        });
        const data = await res.json();
        return data.reply || 'Sorry, I could not generate a response.';
    }, [mode]);

    // ── Core flow: process the user's answer ──
    const processAnswer = useCallback(async (transcript: string) => {
        if (!transcript.trim() || isProcessingRef.current) return;
        isProcessingRef.current = true;

        // Stop listening
        recognitionRef.current?.stop();

        // Add candidate message
        const candidateMsg: ChatMessage = { role: 'candidate', text: transcript.trim() };
        const newHistory = [...chatHistory, candidateMsg];
        setChatHistory(newHistory);
        setLiveTranscript('');
        setPhase('processing');

        try {
            const aiReply = await sendToAI(transcript.trim(), newHistory);
            const aiMsg: ChatMessage = { role: 'ai', text: aiReply };
            const updatedHistory = [...newHistory, aiMsg];
            setChatHistory(updatedHistory);

            // Speak AI response
            setPhase('speaking');
            if (!isSpeechMuted) {
                await speakText(aiReply);
            }

            // Auto-restart listening
            setLiveTranscript('');
            setPhase('listening');
            try { recognitionRef.current?.start(); } catch { }
        } catch (err) {
            console.error('AI error:', err);
            setPhase('listening');
            try { recognitionRef.current?.start(); } catch { }
        } finally {
            isProcessingRef.current = false;
        }
    }, [chatHistory, sendToAI, isSpeechMuted]);

    // ── Start interview ──
    const startInterview = useCallback(async () => {
        setPhase('processing');
        setChatHistory([]);
        setLiveTranscript('');
        isProcessingRef.current = true;

        try {
            const greeting = await sendToAI('Start the interview. Introduce yourself and ask the first question.', []);
            const aiMsg: ChatMessage = { role: 'ai', text: greeting };
            setChatHistory([aiMsg]);

            setPhase('speaking');
            if (!isSpeechMuted) {
                await speakText(greeting);
            }

            // Auto-start listening
            setLiveTranscript('');
            setPhase('listening');
            try { recognitionRef.current?.start(); } catch { }
        } catch (err) {
            console.error('Start error:', err);
            setPhase('idle');
        } finally {
            isProcessingRef.current = false;
        }
    }, [sendToAI, isSpeechMuted]);

    // ── Stop & Submit current answer ──
    const submitAnswer = () => {
        recognitionRef.current?.stop();
        if (liveTranscript.trim()) {
            processAnswer(liveTranscript);
        }
    };

    // ── Reset ──
    const resetAll = () => {
        stopSpeaking();
        recognitionRef.current?.stop();
        setPhase('idle');
        setChatHistory([]);
        setLiveTranscript('');
        isProcessingRef.current = false;
    };

    const isActive = phase !== 'idle';

    return (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden max-w-4xl mx-auto my-12">
            {/* ── Header ── */}
            <div className="p-6 md:p-10 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
                <div className="absolute bottom-0 left-0 w-60 h-60 bg-purple-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4"></div>
                <div className="relative z-10">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-indigo-500/20 backdrop-blur-md rounded-xl flex items-center justify-center border border-indigo-400/30">
                                    <BrainCircuit className="text-indigo-300 w-5 h-5" />
                                </div>
                                <span className="text-indigo-300 font-bold uppercase tracking-wider text-xs">Live Voice Interview</span>
                                {isActive && (
                                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Active
                                    </span>
                                )}
                            </div>
                            <h2 className="text-2xl md:text-3xl font-black mb-1">AI Interview Coach</h2>
                            <p className="text-slate-400 font-medium text-sm">Speak naturally — the AI listens, responds, and asks follow-ups in real time</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {isActive && (
                                <button onClick={() => { setIsSpeechMuted(!isSpeechMuted); if (!isSpeechMuted) stopSpeaking(); }} className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors" title={isSpeechMuted ? 'Unmute AI voice' : 'Mute AI voice'}>
                                    {isSpeechMuted ? <VolumeX className="w-5 h-5 text-slate-300" /> : <Volume2 className="w-5 h-5 text-slate-300" />}
                                </button>
                            )}
                            {isActive && (
                                <button onClick={resetAll} className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors" title="End Interview">
                                    <RotateCcw className="w-5 h-5 text-slate-300" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-5 md:p-8">
                {!hasSpeechAPI && (
                    <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex gap-3 text-rose-700">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="text-sm font-medium">Speech API not supported. Use Chrome or Edge.</p>
                    </div>
                )}

                {/* ── IDLE: Mode selector + Start ── */}
                {phase === 'idle' && (
                    <div className="flex flex-col items-center py-10 text-center">
                        {/* Mode Selector */}
                        <div className="relative mb-8 w-full max-w-sm">
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Interview Mode</label>
                            <button
                                onClick={() => setShowModeMenu(!showModeMenu)}
                                className="w-full flex items-center justify-between gap-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl px-5 py-4 transition-colors"
                            >
                                <span className="flex items-center gap-3">
                                    <span className="text-2xl">{MODE_LABELS[mode].emoji}</span>
                                    <span>
                                        <span className="block text-left font-bold text-slate-900">{MODE_LABELS[mode].label}</span>
                                        <span className="block text-left text-xs text-slate-500">{MODE_LABELS[mode].desc}</span>
                                    </span>
                                </span>
                                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showModeMenu ? 'rotate-180' : ''}`} />
                            </button>
                            <AnimatePresence>
                                {showModeMenu && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-100 shadow-xl z-20 overflow-hidden"
                                    >
                                        {(Object.keys(MODE_LABELS) as InterviewMode[]).map((m) => (
                                            <button
                                                key={m}
                                                onClick={() => { setMode(m); setShowModeMenu(false); }}
                                                className={`w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors ${mode === m ? 'bg-indigo-50' : ''}`}
                                            >
                                                <span className="text-xl">{MODE_LABELS[m].emoji}</span>
                                                <span>
                                                    <span className={`block font-bold text-sm ${mode === m ? 'text-indigo-700' : 'text-slate-900'}`}>{MODE_LABELS[m].label}</span>
                                                    <span className="block text-xs text-slate-500">{MODE_LABELS[m].desc}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 border-2 border-indigo-100">
                            <Mic className="w-12 h-12 text-indigo-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-2">Ready for Practice?</h3>
                        <p className="text-slate-500 text-sm max-w-md mb-1">The AI will ask interview questions and you respond verbally. It loops automatically — like a real interview.</p>
                        <p className="text-xs text-slate-400 mb-8">
                            Candidate: <span className="font-semibold text-slate-600">{currentUser.name}</span>
                        </p>

                        <button
                            onClick={startInterview}
                            disabled={!hasSpeechAPI}
                            className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-200 flex items-center gap-3"
                        >
                            <BrainCircuit className="w-6 h-6" /> Start Interview
                        </button>
                    </div>
                )}

                {/* ── ACTIVE INTERVIEW ── */}
                {isActive && (
                    <div>
                        {/* Status bar */}
                        <div className="flex justify-between items-center mb-4 px-1">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">{MODE_LABELS[mode].emoji}</span>
                                <span className="text-xs font-bold text-slate-500">{MODE_LABELS[mode].label}</span>
                            </div>
                            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${phase === 'speaking' ? 'bg-indigo-50 text-indigo-600' :
                                    phase === 'listening' ? 'bg-emerald-50 text-emerald-600' :
                                        'bg-amber-50 text-amber-600'
                                }`}>
                                {phase === 'speaking' ? '🔊 AI Speaking' : phase === 'listening' ? '🎤 Your Turn' : '⏳ AI Thinking...'}
                            </span>
                        </div>

                        {/* Chat bubbles */}
                        <div className="bg-slate-50 rounded-3xl border border-slate-100 p-4 mb-5 min-h-[250px] max-h-[420px] overflow-y-auto space-y-4">
                            <AnimatePresence>
                                {chatHistory.map((msg, idx) => (
                                    <motion.div
                                        key={idx}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.25 }}
                                        className={`flex gap-2.5 ${msg.role === 'candidate' ? 'flex-row-reverse' : ''}`}
                                    >
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'ai' ? 'bg-indigo-100' : 'bg-emerald-100'}`}>
                                            {msg.role === 'ai' ? <Bot className="w-4 h-4 text-indigo-600" /> : <User className="w-4 h-4 text-emerald-600" />}
                                        </div>
                                        <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm font-medium leading-relaxed ${msg.role === 'ai' ? 'bg-white border border-slate-100 text-slate-800 rounded-tl-md' : 'bg-indigo-600 text-white rounded-tr-md'
                                            }`}>
                                            {msg.text}
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                            {/* Live transcript preview */}
                            {phase === 'listening' && liveTranscript && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5 flex-row-reverse">
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-emerald-100">
                                        <User className="w-4 h-4 text-emerald-600" />
                                    </div>
                                    <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-md text-sm font-medium leading-relaxed bg-emerald-50 border border-emerald-100 text-emerald-700 italic">
                                        {liveTranscript}
                                        <span className="inline-block w-1 h-4 bg-emerald-400 ml-1 animate-pulse align-middle rounded-full"></span>
                                    </div>
                                </motion.div>
                            )}

                            {/* AI speaking waves */}
                            {phase === 'speaking' && (
                                <div className="flex items-center gap-2 text-indigo-500 text-xs font-bold pl-11">
                                    <Volume2 className="w-4 h-4 animate-pulse" />
                                    <div className="flex gap-0.5 items-end h-4">
                                        {[3, 5, 2, 6, 4, 3, 5].map((h, i) => (
                                            <motion.div
                                                key={i}
                                                className="w-1 bg-indigo-400 rounded-full"
                                                animate={{ height: [h * 2, h * 4, h * 2] }}
                                                transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.08 }}
                                            />
                                        ))}
                                    </div>
                                    Speaking...
                                </div>
                            )}

                            {/* Processing */}
                            {phase === 'processing' && (
                                <div className="flex items-center gap-2 text-slate-400 text-xs font-bold pl-11">
                                    <Loader2 className="w-4 h-4 animate-spin" /> AI is thinking...
                                </div>
                            )}

                            <div ref={chatEndRef} />
                        </div>

                        {/* ── Mic Controls ── */}
                        {phase === 'listening' && (
                            <div className="flex flex-col items-center gap-4 pt-2">
                                <div className="relative">
                                    {liveTranscript && (
                                        <motion.div
                                            animate={{ scale: [1, 1.25, 1], opacity: [0.3, 0.6, 0.3] }}
                                            transition={{ repeat: Infinity, duration: 1.5 }}
                                            className="absolute inset-0 bg-emerald-500 rounded-full blur-xl"
                                        />
                                    )}
                                    <div className="relative z-10 w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center shadow-2xl">
                                        <Mic className="w-8 h-8 text-white" />
                                        <motion.div
                                            className="absolute inset-0 rounded-full border-2 border-emerald-400"
                                            animate={{ scale: [1, 1.15, 1], opacity: [0.8, 0.3, 0.8] }}
                                            transition={{ repeat: Infinity, duration: 2 }}
                                        />
                                    </div>
                                </div>
                                <p className="text-slate-500 font-bold text-xs">
                                    {liveTranscript ? 'Listening... Click Send when done' : 'Listening — speak your answer'}
                                </p>
                                {liveTranscript && (
                                    <button onClick={submitAnswer} className="bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200">
                                        <Square className="w-4 h-4 fill-current" /> Send Answer
                                    </button>
                                )}
                            </div>
                        )}

                        {phase === 'speaking' && (
                            <div className="flex justify-center pt-2">
                                <button onClick={() => { stopSpeaking(); setPhase('listening'); setLiveTranscript(''); try { recognitionRef.current?.start(); } catch { } }} className="text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors flex items-center gap-2">
                                    <VolumeX className="w-4 h-4" /> Skip AI speech
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

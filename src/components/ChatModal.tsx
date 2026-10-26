import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Send, Video, Phone } from 'lucide-react';
import { Message, Application, UserProfile } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// API helpers for chat messages
async function apiGetChatMessages(applicationId: string): Promise<Message[]> {
  try {
    const res = await fetch(`/api/db/messages/${applicationId}`);
    return await res.json();
  } catch { return []; }
}

async function apiAddChatMessage(applicationId: string, message: Message) {
  await fetch(`/api/db/messages/${applicationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
}

async function apiUpdateVideoCallStatus(applicationId: string, messageId: string, status: 'accepted' | 'rejected') {
  await fetch(`/api/db/messages/${applicationId}/${messageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoCallStatus: status })
  });
}

export const ChatModal = ({ application, currentUser, onClose }: { application: Application, currentUser: UserProfile, onClose: () => void }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load messages from global API
    const loadMessages = async () => {
      const stored = await apiGetChatMessages(application.id);
      setMessages(stored);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };
    loadMessages();
  }, [application.id]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const msg: Message = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      chatId: application.id,
      senderId: currentUser.uid,
      text: newMessage,
      timestamp: Date.now()
    };

    const updated = [...messages, msg];
    setMessages(updated);
    await apiAddChatMessage(application.id, msg);
    setNewMessage('');
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleVideoCallRequest = async () => {
    const roomName = `hirely-interview-${application.id}-${Date.now()}`;
    const meetUrl = `https://meet.jit.si/${roomName}`;

    const msg: Message = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      chatId: application.id,
      senderId: currentUser.uid,
      text: `Requested a video interview.`,
      timestamp: Date.now(),
      isVideoCallRequest: true,
      videoCallStatus: 'pending',
      videoCallUrl: meetUrl
    };

    const updated = [...messages, msg];
    setMessages(updated);
    await apiAddChatMessage(application.id, msg);
  };

  const updateVideoCallStatus = async (messageId: string, status: 'accepted' | 'rejected') => {
    const updatedMessages = messages.map(msg =>
      msg.id === messageId ? { ...msg, videoCallStatus: status } : msg
    );
    setMessages(updatedMessages);
    await apiUpdateVideoCallStatus(application.id, messageId, status);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-[2rem] w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl relative overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Interview Chat</h2>
            <p className="text-sm text-slate-500">Application ID: {application.id}</p>
          </div>
          <div className="flex items-center gap-4">
            {currentUser.role === 'recruiter' && (
              <button onClick={handleVideoCallRequest} className="p-2 bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-200 transition-colors" title="Request Video Interview">
                <Video className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
          {messages.map(msg => {
            const isMine = msg.senderId === currentUser.uid;
            return (
              <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[80%] p-4 rounded-2xl ${isMine ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-100 text-slate-800 rounded-tl-sm shadow-sm'}`}>
                  <p>{msg.text}</p>

                  {msg.isVideoCallRequest && (
                    <div className="mt-4 p-4 bg-white/10 rounded-xl border border-white/20">
                      <div className="flex items-center gap-2 mb-2 font-bold">
                        <Video className="w-4 h-4" /> Video Interview Request
                      </div>
                      {msg.videoCallStatus === 'pending' ? (
                        isMine ? (
                          <p className="text-sm opacity-80">Waiting for response...</p>
                        ) : (
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => updateVideoCallStatus(msg.id, 'accepted')} className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-bold hover:bg-emerald-600">Accept</button>
                            <button onClick={() => updateVideoCallStatus(msg.id, 'rejected')} className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm font-bold hover:bg-rose-600">Decline</button>
                          </div>
                        )
                      ) : msg.videoCallStatus === 'accepted' ? (
                        <div>
                          <p className="text-sm font-bold text-emerald-400 mb-2">Accepted</p>
                          <a href={msg.videoCallUrl} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm font-bold hover:bg-indigo-600">Join Call</a>
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-rose-400">Declined</p>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 mt-1">{new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-slate-100">
          <form onSubmit={handleSendMessage} className="flex gap-2 relative">
            <input
              type="text"
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 pl-4 pr-12 py-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button type="submit" disabled={!newMessage.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

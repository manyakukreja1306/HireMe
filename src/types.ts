export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  type: 'Full-time' | 'Part-time' | 'Contract' | 'Remote';
  salary: string;
  category: string;
  postedAt: string;
  description: string;
  requiredSkills?: string[];
  preferredSkills?: string[];
  logo: string;
  aiMatchScore?: number;
  employerId?: string;
  documentUrl?: string;
  isExternal?: boolean; // Added for external API
  externalUrl?: string; // Added for external API
}

export interface Company {
  id: string;
  name: string;
  logo: string;
  description: string;
  industry: string;
  size: string;
  founded: string;
  milestones: { year: string; event: string }[];
}

export interface Stat {
  label: string;
  value: string;
  icon: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: 'candidate' | 'recruiter';
  name: string;
}

export interface Application {
  id: string;
  jobId: string;
  employerId?: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  appliedAt: number;
  status: 'pending' | 'reviewed' | 'accepted' | 'rejected' | 'on_hold';
  resumeUrl?: string;
  messages?: Message[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  timestamp: number;
  isVideoCallRequest?: boolean;
  videoCallStatus?: 'pending' | 'accepted' | 'rejected';
  videoCallUrl?: string;
}

export interface Chat {
  id: string;
  applicationId: string;
  jobId: string;
  employerId: string;
  candidateId: string;
  employerName: string;
  candidateName: string;
  jobTitle: string;
  lastMessage?: string;
  lastMessageTime?: number;
}

import { Job, Company, Stat } from './types';

export const jobs: Job[] = [
  {
    id: '1',
    title: 'Senior Product Designer',
    company: 'DesignFlow',
    location: 'San Francisco, CA',
    type: 'Full-time',
    salary: '$140k - $180k',
    category: 'Design',
    postedAt: '2h ago',
    description: 'Lead the design of our next-generation creative tools.',
    logo: 'https://picsum.photos/seed/design/100/100',
    aiMatchScore: 98
  },
  {
    id: '2',
    title: 'AI Research Engineer',
    company: 'NeuralCore',
    location: 'Remote',
    type: 'Full-time',
    salary: '$160k - $220k',
    category: 'Engineering',
    postedAt: '5h ago',
    description: 'Work on cutting-edge LLM architectures and optimization.',
    logo: 'https://picsum.photos/seed/ai/100/100',
    aiMatchScore: 95
  },
  {
    id: '3',
    title: 'Marketing Strategist',
    company: 'GrowthPulse',
    location: 'New York, NY',
    type: 'Contract',
    salary: '$80k - $110k',
    category: 'Marketing',
    postedAt: '1d ago',
    description: 'Drive user acquisition for our rapidly growing SaaS platform.',
    logo: 'https://picsum.photos/seed/marketing/100/100',
    aiMatchScore: 82
  },
  {
    id: '4',
    title: 'Frontend Developer (React)',
    company: 'WebCraft',
    location: 'Austin, TX',
    type: 'Full-time',
    salary: '$120k - $150k',
    category: 'Engineering',
    postedAt: '3h ago',
    description: 'Build beautiful and performant user interfaces using React and Tailwind.',
    logo: 'https://picsum.photos/seed/web/100/100',
    aiMatchScore: 91
  }
];

export const companies: Company[] = [
  {
    id: 'c1',
    name: 'NeuralCore',
    logo: 'https://picsum.photos/seed/neural/200/200',
    description: 'Pioneering the future of artificial general intelligence with a focus on ethical deployment.',
    industry: 'Artificial Intelligence',
    size: '500-1000 employees',
    founded: '2019',
    milestones: [
      { year: '2019', event: 'Founded in San Francisco' },
      { year: '2021', event: 'Series B funding of $100M' },
      { year: '2023', event: 'Launched Core-1 LLM' }
    ]
  },
  {
    id: 'c2',
    name: 'DesignFlow',
    logo: 'https://picsum.photos/seed/flow/200/200',
    description: 'The all-in-one platform for creative teams to collaborate and build amazing products.',
    industry: 'Software',
    size: '200-500 employees',
    founded: '2015',
    milestones: [
      { year: '2015', event: 'First prototype launched' },
      { year: '2018', event: 'Reached 1M active users' },
      { year: '2024', event: 'Acquired by TechGiant' }
    ]
  }
];

export const stats: Stat[] = [
  { label: 'Active Jobs', value: '12,450+', icon: 'Briefcase' },
  { label: 'Companies', value: '850+', icon: 'Building2' },
  { label: 'AI Matches', value: '45k+', icon: 'Zap' },
  { label: 'Success Rate', value: '94%', icon: 'Trophy' }
];

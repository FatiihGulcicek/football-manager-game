import {
  CalendarDays,
  ClipboardList,
  Dumbbell,
  LineChart,
  Mail,
  Users
} from 'lucide-react';
import type { DashboardViewModel } from '../types';

export const mockDashboard: DashboardViewModel = {
  managerName: 'Fatih Gulcicek',
  club: {
    name: 'Northbridge FC',
    shortName: 'NBR',
    status: 'ACTIVE',
    foundedYear: 1998,
    reputation: 6840,
    fanCountLabel: '42.8K',
    stadiumName: 'Northbridge Park',
    stadiumCapacityLabel: '31,400',
    primaryColor: '#2DD4BF',
    secondaryColor: '#F8D66D',
    supporterHappiness: 76
  },
  financials: {
    balance: '€42,580,000.00',
    transferBudget: '€8,750,000.00',
    wageBudget: '€615,000.00',
    currencyCode: 'EUR',
    weeklyProjection: '+€180K'
  },
  upcomingMatch: {
    opponent: 'Riverport Athletic',
    competition: 'Premier Division',
    venue: 'Home',
    kickoffLabel: 'Sat 19:30',
    tacticalFocus: 'Exploit wide channels',
    opponentForm: ['D', 'W', 'L', 'W', 'D']
  },
  standings: [
    { position: 1, club: 'Highland City', played: 12, goalDifference: 18, points: 29, trend: 'same' },
    { position: 2, club: 'Northbridge FC', played: 12, goalDifference: 14, points: 27, trend: 'up', isCurrentClub: true },
    { position: 3, club: 'Riverport Athletic', played: 12, goalDifference: 11, points: 25, trend: 'down' },
    { position: 4, club: 'Eastgate Borough', played: 12, goalDifference: 7, points: 22, trend: 'same' },
    { position: 5, club: 'Stonefield Rovers', played: 12, goalDifference: 5, points: 20, trend: 'up' }
  ],
  teamForm: ['W', 'W', 'D', 'L', 'W'],
  news: [
    {
      id: 'news-1',
      category: 'Board',
      title: 'Board pleased with recent home performances',
      timeLabel: '18 min ago',
      priority: 'medium'
    },
    {
      id: 'news-2',
      category: 'Training',
      title: 'Aydin Kaya tops weekly intensity report',
      timeLabel: '1 hr ago',
      priority: 'low'
    },
    {
      id: 'news-3',
      category: 'Medical',
      title: 'Leon Marsh returns to full squad sessions',
      timeLabel: '3 hrs ago',
      priority: 'high'
    }
  ],
  boardExpectations: [
    { id: 'exp-1', label: 'League objective', current: 'Top half finish', progress: 68, tone: 'success' },
    { id: 'exp-2', label: 'Financial control', current: 'Stay within wage plan', progress: 82, tone: 'success' },
    { id: 'exp-3', label: 'Youth minutes', current: 'Develop first-team prospects', progress: 44, tone: 'warning' }
  ],
  quickActions: [
    {
      id: 'qa-1',
      label: 'Review squad',
      description: 'Condition, form and availability',
      disabled: true,
      icon: Users
    },
    {
      id: 'qa-2',
      label: 'Set tactics',
      description: 'Match plan and instructions',
      disabled: true,
      icon: ClipboardList
    },
    {
      id: 'qa-3',
      label: 'Training plan',
      description: 'Prepare the weekly workload',
      disabled: true,
      icon: Dumbbell
    },
    {
      id: 'qa-4',
      label: 'Inbox',
      description: 'Club messages and reports',
      disabled: true,
      icon: Mail
    },
    {
      id: 'qa-5',
      label: 'Finance review',
      description: 'Budgets and projections',
      disabled: true,
      icon: LineChart
    },
    {
      id: 'qa-6',
      label: 'Calendar',
      description: 'Fixtures and deadlines',
      disabled: true,
      icon: CalendarDays
    }
  ],
  featuredPlayers: [
    {
      id: 'player-1',
      name: 'Aydin Kaya',
      position: 'AMC',
      age: 22,
      rating: 78,
      condition: 93,
      form: ['W', 'W', 'D', 'W', 'W'],
      note: 'Creative hub, excellent between the lines'
    },
    {
      id: 'player-2',
      name: 'Milo Hart',
      position: 'GK',
      age: 27,
      rating: 75,
      condition: 88,
      form: ['D', 'W', 'W', 'L', 'W'],
      note: 'Commanding area well under pressure'
    },
    {
      id: 'player-3',
      name: 'Jonas Vale',
      position: 'ST',
      age: 24,
      rating: 73,
      condition: 81,
      form: ['W', 'L', 'D', 'W', 'D'],
      note: 'Needs sharper finishing in transition'
    }
  ],
  calendar: [
    { id: 'cal-1', dateLabel: 'Sat', title: 'Riverport Athletic', meta: 'Home, 19:30', type: 'match' },
    { id: 'cal-2', dateLabel: 'Mon', title: 'Recovery session', meta: 'Training Ground', type: 'training' },
    { id: 'cal-3', dateLabel: 'Wed', title: 'Board review', meta: 'Monthly objectives', type: 'board' },
    { id: 'cal-4', dateLabel: 'Fri', title: 'Scout shortlist', meta: 'Final report due', type: 'scouting' }
  ]
};

export const emptyDashboard: DashboardViewModel = {
  ...mockDashboard,
  upcomingMatch: null,
  standings: [],
  news: [],
  calendar: []
};

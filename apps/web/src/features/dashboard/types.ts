import type { LucideIcon } from 'lucide-react';

export type DashboardClub = {
  name: string;
  shortName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  foundedYear: number | null;
  reputation: number;
  fanCountLabel: string;
  stadiumName: string;
  stadiumCapacityLabel: string;
  primaryColor: string;
  secondaryColor: string;
  supporterHappiness: number;
};

export type DashboardFinancials = {
  balance: string;
  transferBudget: string;
  wageBudget: string;
  currencyCode: string;
  weeklyProjection: string;
};

export type UpcomingMatch = {
  opponent: string;
  competition: string;
  venue: 'Home' | 'Away';
  kickoffLabel: string;
  tacticalFocus: string;
  opponentForm: TeamFormResult[];
};

export type LeagueStandingRow = {
  position: number;
  club: string;
  played: number;
  goalDifference: number;
  points: number;
  trend: 'up' | 'down' | 'same';
  isCurrentClub?: boolean;
};

export type TeamFormResult = 'W' | 'D' | 'L';

export type NewsItem = {
  id: string;
  category: string;
  title: string;
  timeLabel: string;
  priority: 'low' | 'medium' | 'high';
};

export type BoardExpectation = {
  id: string;
  label: string;
  current: string;
  progress: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
};

export type QuickAction = {
  id: string;
  label: string;
  description: string;
  href?: string;
  disabled?: boolean;
  icon: LucideIcon;
};

export type PlayerSpotlight = {
  id: string;
  name: string;
  position: string;
  age: number;
  rating: number;
  condition: number;
  form: TeamFormResult[];
  note: string;
};

export type CalendarItem = {
  id: string;
  dateLabel: string;
  title: string;
  meta: string;
  type: 'match' | 'training' | 'board' | 'scouting';
};

export type DashboardViewModel = {
  managerName: string;
  club: DashboardClub;
  financials: DashboardFinancials;
  upcomingMatch: UpcomingMatch | null;
  standings: LeagueStandingRow[];
  teamForm: TeamFormResult[];
  news: NewsItem[];
  boardExpectations: BoardExpectation[];
  quickActions: QuickAction[];
  featuredPlayers: PlayerSpotlight[];
  calendar: CalendarItem[];
};

export type ClubMeApiDto = {
  id?: string;
  currentManagerProfileId?: string;
  name: string;
  shortName: string;
  status: DashboardClub['status'];
  foundedYear: number | null;
  reputation: number;
  fanBase: number;
  stadiumName: string;
  stadiumCapacity: number;
  primaryColor: string;
  secondaryColor: string;
  balance: string;
  transferBudget: string;
  wageBudget: string;
  currencyCode: string;
};

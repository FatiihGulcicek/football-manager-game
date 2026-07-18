export type PlayerPosition = 'GK' | 'RB' | 'CB' | 'LB' | 'DM' | 'CM' | 'AM' | 'RW' | 'LW' | 'ST';

export type PlayerAvailability = 'Available' | 'Injured' | 'Suspended' | 'Unavailable' | 'Loan';

export type PlayerStatusType =
  | 'injured'
  | 'suspended'
  | 'loan'
  | 'transfer-listed'
  | 'contract-expiring'
  | 'unavailable';

export type PlayerMorale = 'Excellent' | 'Good' | 'Concerned' | 'Poor';

export type SquadContractState = 'Stable' | 'Expiring' | 'Long';

export type SquadPlayer = {
  id: string;
  name: string;
  shirtNumber: number;
  position: PlayerPosition;
  age: number;
  nationality: string;
  rating: number;
  potential: number;
  condition: number;
  sharpness: number;
  morale: PlayerMorale;
  appearances: number;
  goals: number;
  assists: number;
  contract: string;
  contractState: SquadContractState;
  weeklyWage: string;
  marketValue: string;
  availability: PlayerAvailability;
  statuses: PlayerStatusType[];
  isCaptain: boolean;
  isViceCaptain: boolean;
  isHomegrown: boolean;
  isForeign: boolean;
};

export type SquadSummary = {
  totalPlayers: number;
  averageAge: string;
  weeklyWage: string;
  squadValue: string;
  homegrown: number;
  foreignPlayers: number;
  injured: number;
  unavailable: number;
};

export type PositionDepthGroup = {
  id: string;
  label: PlayerPosition;
  zoneClass: string;
  starter: string;
  backups: string[];
  isWeak: boolean;
};

export type SquadInsightTone = 'success' | 'warning' | 'danger' | 'neutral';

export type SquadInsight = {
  id: string;
  label: string;
  description: string;
  tone: SquadInsightTone;
};

export type SquadViewModel = {
  managerName: string;
  club: {
    name: string;
    shortName: string;
    season: string;
    competition: string;
    transferWindowState: string;
    primaryColor: string;
    secondaryColor: string;
  };
  summary: SquadSummary;
  players: SquadPlayer[];
  positionDepth: PositionDepthGroup[];
  insights: SquadInsight[];
};

export type SquadFilters = {
  search: string;
  position: PlayerPosition | 'all';
  availability: PlayerAvailability | 'all';
  contract: SquadContractState | 'all';
  age: 'all' | 'under-23' | 'prime' | 'senior';
  condition: 'all' | 'ready' | 'tired' | 'recovery';
  sort: 'rating' | 'potential' | 'position' | 'condition' | 'value';
  view: 'table' | 'cards';
};

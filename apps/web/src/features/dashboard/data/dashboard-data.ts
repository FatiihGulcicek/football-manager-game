import { mockDashboard } from './mock-dashboard';
import type { ClubMeApiDto, DashboardClub, DashboardFinancials, DashboardViewModel } from '../types';

export async function getDashboardViewModel(): Promise<DashboardViewModel> {
  return mockDashboard;
}

export function createDashboardViewModelFromClub(club: ClubMeApiDto): DashboardViewModel {
  return {
    ...mockDashboard,
    club: mapClubMeToDashboardClub(club),
    financials: mapClubMeToFinancials(club)
  };
}

export function mapClubMeToDashboardClub(club: ClubMeApiDto): DashboardClub {
  return {
    name: club.name,
    shortName: club.shortName,
    status: club.status,
    foundedYear: club.foundedYear,
    reputation: club.reputation,
    fanCountLabel: formatCompactInteger(club.fanBase),
    stadiumName: club.stadiumName,
    stadiumCapacityLabel: formatInteger(club.stadiumCapacity),
    primaryColor: club.primaryColor,
    secondaryColor: club.secondaryColor,
    supporterHappiness: mockDashboard.club.supporterHappiness
  };
}

function mapClubMeToFinancials(club: ClubMeApiDto): DashboardFinancials {
  return {
    balance: formatMoneyString(club.balance, club.currencyCode),
    transferBudget: formatMoneyString(club.transferBudget, club.currencyCode),
    wageBudget: formatMoneyString(club.wageBudget, club.currencyCode),
    currencyCode: club.currencyCode,
    weeklyProjection: mockDashboard.financials.weeklyProjection
  };
}

function formatMoneyString(value: string, currencyCode: string): string {
  const symbol = currencyCode === 'EUR' ? '€' : `${currencyCode} `;

  return value.startsWith(symbol) ? value : `${symbol}${value}`;
}

function formatCompactInteger(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toString();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0
  }).format(value);
}

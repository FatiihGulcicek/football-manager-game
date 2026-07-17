import type { DashboardViewModel } from '../types';
import { AppShell } from './app-shell';
import { BoardExpectations } from './board-expectations';
import { CalendarPreview } from './calendar-preview';
import { ClubHero } from './club-hero';
import { LeagueTablePreview } from './league-table-preview';
import { MatchCard } from './match-card';
import { NewsFeed } from './news-feed';
import { PlayerSpotlightCard } from './player-spotlight-card';
import { QuickActions } from './quick-actions';
import { TeamFormCard } from './team-form-card';

type DashboardViewProps = {
  viewModel: DashboardViewModel;
};

export function DashboardView({ viewModel }: DashboardViewProps) {
  return (
    <AppShell activePath="/dashboard" managerName={viewModel.managerName}>
      <div className="dashboard-grid">
        <ClubHero club={viewModel.club} financials={viewModel.financials} />
        <MatchCard match={viewModel.upcomingMatch} />
        <TeamFormCard results={viewModel.teamForm} />
        <LeagueTablePreview rows={viewModel.standings} />
        <BoardExpectations expectations={viewModel.boardExpectations} />
        <QuickActions actions={viewModel.quickActions} />
        <PlayerSpotlightCard players={viewModel.featuredPlayers} />
        <NewsFeed items={viewModel.news} />
        <CalendarPreview items={viewModel.calendar} />
      </div>
    </AppShell>
  );
}

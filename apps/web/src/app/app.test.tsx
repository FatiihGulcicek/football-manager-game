import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DashboardView } from '../features/dashboard/components/dashboard-view';
import { MobileNavigation } from '../features/dashboard/components/mobile-navigation';
import { Sidebar } from '../features/dashboard/components/sidebar';
import { createDashboardViewModelFromClub } from '../features/dashboard/data/dashboard-data';
import { emptyDashboard, mockDashboard } from '../features/dashboard/data/mock-dashboard';
import RootLayout from './layout';

describe('Dashboard foundation', () => {
  it('renders the core dashboard sections', () => {
    const html = renderToStaticMarkup(<DashboardView viewModel={mockDashboard} />);

    expect(html).toContain('Club news');
    expect(html).toContain('Board');
    expect(html).toContain('Upcoming match');
    expect(html).toContain('League standings');
    expect(html).toContain('Featured players');
    expect(html).toContain('Calendar');
    expect(html).toContain('Finance room');
    expect(html).toContain('Budget control');
    expect(html).toContain('dashboard-match');
    expect(html).toContain('dashboard-table');
    expect(html).toContain('dashboard-form');
  });

  it('marks the active dashboard navigation item', () => {
    const html = renderToStaticMarkup(<Sidebar activePath="/dashboard" />);

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Dashboard');
  });

  it('renders mobile navigation without browser-only APIs', () => {
    const html = renderToStaticMarkup(<MobileNavigation activePath="/dashboard" />);

    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('Dashboard');
  });

  it('selects mobile navigation items with stable ids instead of magic array indexes', () => {
    const navigationSource = readFileSync(join(process.cwd(), 'src/features/dashboard/navigation.ts'), 'utf8');

    expect(navigationSource).toContain('showInMobileNav');
    expect(navigationSource).toContain("id: 'dashboard'");
    expect(navigationSource).not.toContain('navigationItems[0]');
    expect(navigationSource).not.toContain('navigationItems[1]');
    expect(navigationSource).not.toContain('navigationItems[2]');
    expect(navigationSource).not.toContain('navigationItems[12]');
  });

  it('renders financial values as formatted strings', () => {
    const html = renderToStaticMarkup(<DashboardView viewModel={mockDashboard} />);

    expect(html).toContain('€42,580,000.00');
    expect(html).toContain('€8,750,000.00');
    expect(html).toContain('€615,000.00');
  });

  it('renders empty states for future-domain data', () => {
    const html = renderToStaticMarkup(<DashboardView viewModel={emptyDashboard} />);

    expect(html).toContain('No club news');
    expect(html).toContain('No fixture scheduled');
    expect(html).toContain('No league table yet');
    expect(html).toContain('No calendar items');
    expect(html).toContain('No board expectations');
    expect(html).toContain('No featured players');
    expect(html).toContain('No quick actions');
    expect(html).toContain('No recent form');
  });

  it('does not expose internal manager identifiers from club API data', () => {
    const viewModel = createDashboardViewModelFromClub({
      id: 'club-internal-id',
      currentManagerProfileId: 'manager-profile-internal-id',
      name: 'Northbridge FC',
      shortName: 'NBR',
      status: 'ACTIVE',
      foundedYear: 1998,
      reputation: 6840,
      fanBase: 42800,
      stadiumName: 'Northbridge Park',
      stadiumCapacity: 31400,
      primaryColor: '#2DD4BF',
      secondaryColor: '#F8D66D',
      balance: '42580000.00',
      transferBudget: '8750000.00',
      wageBudget: '615000.00',
      currencyCode: 'EUR'
    });
    const html = renderToStaticMarkup(<DashboardView viewModel={viewModel} />);

    expect(html).not.toContain('manager-profile-internal-id');
    expect(html).not.toContain('club-internal-id');
  });

  it('renders the dashboard on the server without window access', () => {
    expect(() => renderToStaticMarkup(<DashboardView viewModel={mockDashboard} />)).not.toThrow();
  });

  it('keeps the global dashboard stylesheet connected to the root layout', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <DashboardView viewModel={mockDashboard} />
      </RootLayout>
    );
    const layoutSource = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');

    expect(layoutSource).toContain("import './globals.css'");
    expect(html).toContain('class="dashboard-document"');
    expect(html).toContain('class="dashboard-theme"');
  });

  it('keeps critical dashboard design tokens and shell selectors in globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

    expect(css).toContain('--color-bg-deep');
    expect(css).toContain('--color-bg-panel');
    expect(css).toContain('--color-primary-tint');
    expect(css).toContain('--color-surface');
    expect(css).toContain('--radius-panel');
    expect(css).toContain('.dashboard-theme');
    expect(css).toContain('.app-shell');
    expect(css).toContain('.game-panel');
    expect(css).toContain('.mobile-nav');
    expect(css).toContain('.dashboard-match');
    expect(css).toContain('.dashboard-table');
    expect(css).toContain('.dashboard-players');
    expect(css).not.toMatch(/(^|\n)\.game-panel:nth-child/);
    expect(css).not.toContain('.dashboard-grid > .game-panel:nth-child');
  });
});

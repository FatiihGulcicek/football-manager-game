import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SquadPage } from '../features/squad/components/squad-page';
import { emptySquadViewModel, squadViewModel } from '../features/squad/data/players';
import SquadRoute from './squad/page';

describe('Squad foundation', () => {
  it('renders the squad route inside the existing app shell', async () => {
    const html = renderToStaticMarkup(await SquadRoute());

    expect(html).toContain('aria-label="Squad management"');
    expect(html).toContain('Squad');
    expect(html).toContain('First Team');
    expect(html).toContain('Northbridge FC');
    expect(html).toContain('Winter window open');
  });

  it('renders the compact squad summary strip', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={squadViewModel} />);

    expect(html).toContain('Squad summary');
    expect(html).toContain('Total Players');
    expect(html).toContain('Average Age');
    expect(html).toContain('Weekly Wage');
    expect(html).toContain('Squad Value');
    expect(html).toContain(String(squadViewModel.summary.totalPlayers));
    expect(html).toContain(squadViewModel.summary.weeklyWage);
  });

  it('renders the semantic player table with required columns', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={squadViewModel} />);

    expect(html).toContain('<table');
    expect(html).toContain('First team squad list');
    expect(html).toContain('Player');
    expect(html).toContain('Position');
    expect(html).toContain('Nationality');
    expect(html).toContain('Condition');
    expect(html).toContain('Weekly Wage');
    expect(html).toContain('Market Value');
    expect(html).toContain('Availability');
    expect(html).toContain('Samuel Brooks');
  });

  it('renders desktop filters and the mobile bottom sheet trigger', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={squadViewModel} />);

    expect(html).toContain('Squad filters');
    expect(html).toContain('Search squad');
    expect(html).toContain('All positions');
    expect(html).toContain('Availability');
    expect(html).toContain('Contract');
    expect(html).toContain('Condition');
    expect(html).toContain('Open squad filters');
  });

  it('marks the selected player row and renders the player preview', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={squadViewModel} />);

    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Select Adem Yilmaz');
    expect(html).toContain('Adem Yilmaz preview');
    expect(html).toContain('Open Player Profile');
  });

  it('renders empty squad, tactical panel and insights states', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={emptySquadViewModel} />);

    expect(html).toContain('No players found');
    expect(html).toContain('No player selected');
    expect(html).toContain('No tactical depth data');
    expect(html).toContain('No squad insights');
  });

  it('renders active mobile navigation for the squad route', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={squadViewModel} />);

    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('href="/squad"');
    expect(html).toContain('aria-current="page"');
  });

  it('renders typed mock data without mixing player fixtures into JSX', () => {
    const html = renderToStaticMarkup(<SquadPage viewModel={squadViewModel} />);
    const dataSource = readFileSync(join(process.cwd(), 'src/features/squad/data/players.ts'), 'utf8');
    const componentSource = readFileSync(join(process.cwd(), 'src/features/squad/components/squad-page.tsx'), 'utf8');

    expect(squadViewModel.players.every((player) => typeof player.rating === 'number')).toBe(true);
    expect(squadViewModel.players.every((player) => Array.isArray(player.statuses))).toBe(true);
    expect(dataSource).toContain('SquadPlayer[]');
    expect(componentSource).not.toContain('player-samuel-brooks');
    expect(html).toContain(squadViewModel.players[0].marketValue);
  });

  it('keeps mobile cards, bottom sheet filters and responsive table styles in globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

    expect(css).toContain('.squad-player-cards');
    expect(css).toContain('.bottom-sheet-filters');
    expect(css).toContain('.player-table-scroll');
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('overflow-x: auto');
  });
});

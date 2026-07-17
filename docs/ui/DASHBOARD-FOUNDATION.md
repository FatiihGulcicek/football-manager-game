# Dashboard Foundation

Sprint 5A sonrasi ilk frontend sprinti, `apps/web` icinde premium futbol menajer dashboard temelini kurar. Bu sprint yalniz dashboard UI foundation kapsamindadir; auth UI, real session wiring, live fixtures, oyuncular, transferler ve detayli finans backend ihtiyaclari sonraki sprintlere kalir.

Visual polish kararlari ve final dashboard kompozisyonu `docs/ui/DASHBOARD-POLISH.md` dosyasinda belgelenir.

## Layout Architecture

- Route: `/dashboard`.
- Root `/` route'u `/dashboard` adresine yonlenir.
- Ana shell: `AppShell`.
- Desktop: persistent left sidebar, sticky topbar, 12 kolon responsive content grid.
- Tablet: sidebar compact hale gelir, content panelleri iki kolon akabilir.
- Mobile: desktop sidebar gizlenir, safe-area destekli bottom navigation kullanilir, kartlar tek kolona iner.
- League table mobilde yatay scroll alir; sayfa genelinde horizontal overflow olusmamasi hedeflenir.

## Design Tokens

Global tokenlar `apps/web/src/app/globals.css` icindedir.

- Background: `--color-bg-deep`, `--color-bg`, `--color-bg-elevated`.
- Surface: `--color-surface`, `--color-surface-strong`.
- Border: `--color-border`, `--color-border-strong`.
- Text: `--color-text`, `--color-text-muted`, `--color-text-soft`.
- Action/status: `--color-primary`, `--color-success`, `--color-warning`, `--color-danger`, `--color-gold`.
- Spacing: `--space-1` - `--space-10`.
- Radius: `--radius-sm`, `--radius-md`, `--radius-panel`.
- Motion: `--motion-fast`, `--motion-base`.
- Shadows: `--shadow-panel`, `--shadow-interactive`.

Componentler rastgele renk hardcode etmek yerine bu tokenlari kullanir. Kulup badge renkleri view modelden gelen `primaryColor` ve `secondaryColor` ile CSS variable olarak uygulanir.

## Component Hierarchy

- `AppShell`
  - `Sidebar`
  - `Topbar`
  - `MobileNavigation`
  - dashboard content
- `DashboardView`
  - `ClubHero`
  - `MatchCard`
  - `TeamFormCard`
  - `LeagueTablePreview`
  - `BoardExpectations`
  - `QuickActions`
  - `PlayerSpotlightCard`
  - `NewsFeed`
  - `CalendarPreview`
- Shared primitives:
  - `Panel`
  - `StatCard`
  - `SectionHeader`
  - `StatusBadge`
  - `ProgressIndicator`
  - `DashboardSkeleton`
  - `EmptyState`
  - `ErrorState`

## Responsive Behavior

- `>1180px`: full sidebar and dense desktop grid.
- `<=1180px`: sidebar icon-only, hero single column, panels two column.
- `<=820px`: bottom mobile navigation, single-column dashboard, search hidden, touch targets remain at least 44px.
- `<=520px`: compact topbar/profile buttons and reduced hero badge dimensions.
- `env(safe-area-inset-bottom)` is used for mobile bottom navigation and content padding.

## Mock Data Boundary

Mock data lives in:

- `apps/web/src/features/dashboard/data/mock-dashboard.ts`

The page component does not contain inline mock objects. Runtime loading currently uses:

- `getDashboardViewModel()`

This function returns development mock data until authenticated web API client/session plumbing exists.

## Current API Integration

There is no existing web API client or auth/session integration in `apps/web` yet. Because of that, the dashboard does not perform a live `/clubs/me` request in this sprint.

The mapper boundary is ready for stable `GET /clubs/me` fields:

- club name
- short name
- status
- founded year
- reputation
- fan base
- stadium name
- stadium capacity
- primary and secondary colors
- balance
- transfer budget
- wage budget
- currency code

Internal fields such as `id` and `currentManagerProfileId` are accepted only at mapper input and are not copied into the dashboard view model or rendered UI.

## Future Dashboard Backend Needs

- Authenticated web API client with access-token/session handling.
- Dashboard aggregate endpoint or BFF-style composition endpoint.
- Upcoming fixture source.
- League standings source.
- Team form and player spotlight source.
- Club inbox/news source.
- Board expectations source.
- Calendar/fixtures source.
- Real permission model for quick action links.

## Accessibility Decisions

- The dashboard uses semantic `main`, `aside`, `nav`, `header`, `section`, `table`, `ol` and `ul` landmarks/lists.
- Navigation uses real links for implemented routes and disabled buttons for future placeholders.
- Buttons are actual buttons.
- Icon-only buttons have accessible labels.
- Visible focus states are defined globally.
- Status information uses text labels in addition to color.
- Empty and error states use `role="status"` and `role="alert"` where appropriate.

## Animation Rules

- Motion is subtle: panel hover, navigation active state, progress fill and skeleton loading.
- `prefers-reduced-motion: reduce` disables transitions and long animation.
- No arcade-style bounce, flashing or excessive glow is used.

## Visual Asset Decision

The stadium hero is implemented as a local CSS-based stadium treatment. It does not hotlink remote images and does not use copyrighted club branding.

# Dashboard Visual Polish

Sprint Dashboard Visual Polish, mevcut `/dashboard` foundation mimarisini korur ve arayuzu daha oyun odakli, premium ve futbol menajerligine ozgu hale getirir. Bu sprint backend, auth, veri modeli veya route kapsamini degistirmez.

## Revised Visual Hierarchy

Ilk desktop viewport su sirayla okunacak sekilde duzenlendi:

1. Club identity and stadium hero
2. Compact budget control panel
3. Upcoming match
4. League standings
5. Team form
6. Board expectations
7. Club news
8. Quick actions
9. Featured players
10. Calendar

Dashboard artik generic kart yiginindan cok matchday office hissi verir: badge, pitch markings, compact finance ve scoreboard benzeri veriler ust viewport'ta birlikte gorunur.

## Grid Composition

Content grid 12 kolon mantigini korur, ancak panel boyutlari artik sira tabanli selector'larla degil named semantic layout class'lariyla yonetilir:

- `.dashboard-match`
- `.dashboard-table`
- `.dashboard-form`
- `.dashboard-board`
- `.dashboard-news`
- `.dashboard-actions`
- `.dashboard-players`
- `.dashboard-calendar`

Unscoped `.game-panel:nth-child(...)` kullanimi yasaktir; nested panelleri yanlislikla etkilememesi icin testle korunur.

## Hero Structure

`ClubHero` public prop contract'i degismedi. Hero icinde:

- daha buyuk club badge
- status ve founded year
- stadium name/capacity
- reputation, supporters and happiness metrics
- CSS-only pitch/stadium line treatment
- desktop side finance panel

uygulandi. Harici veya copyrighted stadium gorseli kullanilmaz.

## Finance Panel

Finance bilgileri artik buyuk full-width satirlar yerine compact budget control panelinde gosterilir:

- Balance
- Transfer budget
- Wage plan
- Weekly projection
- Supporter happiness progress

Para degerleri string olarak render edilir. `Number()`, `parseFloat()`, `parseInt()`, unary `+` veya `toNumber()` kullanilmaz.

## Responsive Behavior

- Desktop: persistent sidebar, two-column hero, compact finance side panel and multi-column dashboard grid.
- Tablet: compact sidebar, hero stacks gracefully, named dashboard panels use two-column spans where practical.
- Mobile: sidebar hidden, bottom navigation visible, single-column content, finance cards remain readable, table scrolls inside its own container, page-level horizontal overflow is avoided.

Mobile bottom navigation clearance is scoped to the mobile dashboard content padding; global app frame spacing is not used for desktop.

## Token Changes

Repeated panel and near-black colors were moved behind shared tokens such as:

- `--color-bg-shell`
- `--color-bg-sidebar`
- `--color-bg-panel`
- `--color-bg-panel-soft`
- `--color-bg-panel-deep`
- `--color-primary-active`
- `--color-primary-tint`
- `--color-gold-tint`
- status tint tokens

Focus states and reduced-motion behavior remain global and visible.

## Empty-State Conventions

Empty states now cover:

- upcoming match
- league standings
- news
- calendar
- board expectations
- featured players
- quick actions
- team form

Empty states use the shared `EmptyState` primitive with `role="status"`.

## Mobile Navigation Selection

Mobile navigation no longer selects items with array indexes. Navigation items have stable `id` values and an optional `showInMobileNav` flag. This avoids accidental mobile nav changes when sidebar items are reordered.

## Animation Rules

Interactions remain subtle:

- active navigation indicator
- panel hover depth
- quick action hover
- progress transitions
- skeleton loading

No new animation dependency was added. `prefers-reduced-motion` remains respected.

## Known Remaining Visual Limitations

- Dashboard still uses typed mock data until authenticated API wiring exists.
- Club badge is CSS/generated from club colors, not a real crest.
- Search and most navigation areas remain disabled placeholders until future UI sprints.
- No approved bitmap concept asset exists in the repository for pixel-perfect comparison.

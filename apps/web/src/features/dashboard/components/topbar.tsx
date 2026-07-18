import { Bell, CircleHelp, Inbox, Search, UserRound } from 'lucide-react';

type TopbarProps = {
  managerName: string;
};

export function Topbar({ managerName }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span>Season 2026/27</span>
        <h1>Dashboard</h1>
      </div>

      <form className="topbar-search" role="search" aria-label="Global search">
        <Search aria-hidden="true" size={18} />
        <label className="sr-only" htmlFor="global-search">
          Search club, player or fixture
        </label>
        <input id="global-search" type="search" placeholder="Search club, player or fixture" />
      </form>

      <div className="topbar-actions" aria-label="Manager actions">
        <button className="icon-button" type="button" aria-label="Notifications">
          <Bell aria-hidden="true" size={19} />
          <span className="notification-dot" aria-hidden="true" />
        </button>
        <button className="icon-button topbar-action--desktop" type="button" aria-label="Inbox">
          <Inbox aria-hidden="true" size={19} />
        </button>
        <button className="icon-button topbar-action--desktop" type="button" aria-label="Help">
          <CircleHelp aria-hidden="true" size={19} />
        </button>
        <button className="profile-button topbar-action--desktop" type="button" aria-label="Manager profile menu">
          <UserRound aria-hidden="true" size={18} />
          <span>{managerName}</span>
        </button>
      </div>
    </header>
  );
}

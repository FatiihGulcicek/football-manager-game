import type { ReactNode } from 'react';
import { MobileNavigation } from './mobile-navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

type AppShellProps = {
  activePath: string;
  managerName: string;
  mainLabel?: string;
  children: ReactNode;
};

export function AppShell({
  activePath,
  managerName,
  mainLabel = 'Football manager dashboard',
  children
}: AppShellProps) {
  return (
    <div className="app-shell">
      <Sidebar activePath={activePath} />
      <div className="app-frame">
        <Topbar managerName={managerName} />
        <main className="dashboard-main" aria-label={mainLabel}>
          {children}
        </main>
      </div>
      <MobileNavigation activePath={activePath} />
    </div>
  );
}

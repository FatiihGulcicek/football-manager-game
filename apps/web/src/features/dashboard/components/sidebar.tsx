import Link from 'next/link';
import { navigationItems } from '../navigation';

type SidebarProps = {
  activePath: string;
};

export function Sidebar({ activePath }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-brand" aria-label="Northbridge FC">
        <span className="club-monogram" aria-hidden="true">
          N
        </span>
        <div>
          <strong>Northbridge FC</strong>
          <span>Manager Office</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Game areas">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePath === item.href;

          if (!item.enabled) {
            return (
              <button key={item.id} className="nav-item nav-item--disabled" type="button" disabled>
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </button>
            );
          }

          return (
            <Link key={item.id} className="nav-item" href={item.href} aria-current={isActive ? 'page' : undefined}>
              <Icon aria-hidden="true" size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

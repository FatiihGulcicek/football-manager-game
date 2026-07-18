import {
  BadgeDollarSign,
  Building2,
  CalendarDays,
  ClipboardList,
  Dumbbell,
  Flag,
  Gauge,
  GraduationCap,
  Inbox,
  Landmark,
  LineChart,
  Search,
  Settings,
  Shield,
  Trophy,
  Users,
  UserSearch
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavigationItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
  showInMobileNav?: boolean;
};

export const navigationItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: Gauge, enabled: true, showInMobileNav: true },
  { id: 'squad', label: 'Squad', href: '/squad', icon: Users, enabled: true, showInMobileNav: true },
  { id: 'tactics', label: 'Tactics', href: '/tactics', icon: ClipboardList, enabled: false, showInMobileNav: true },
  { id: 'transfers', label: 'Transfers', href: '/transfers', icon: LineChart, enabled: false },
  { id: 'match-centre', label: 'Match Centre', href: '/match-centre', icon: Trophy, enabled: false },
  { id: 'league', label: 'League / Cups', href: '/league', icon: Flag, enabled: false },
  { id: 'finance', label: 'Finance', href: '/finance', icon: BadgeDollarSign, enabled: false },
  { id: 'facilities', label: 'Facilities', href: '/facilities', icon: Building2, enabled: false },
  { id: 'youth-academy', label: 'Youth Academy', href: '/youth-academy', icon: GraduationCap, enabled: false },
  { id: 'scouting', label: 'Scouting', href: '/scouting', icon: UserSearch, enabled: false },
  { id: 'staff', label: 'Staff', href: '/staff', icon: Shield, enabled: false },
  { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox, enabled: false },
  { id: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarDays, enabled: false, showInMobileNav: true },
  { id: 'club', label: 'Club', href: '/club', icon: Landmark, enabled: false },
  { id: 'board', label: 'Board', href: '/board', icon: Dumbbell, enabled: false },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, enabled: false }
];

export const mobileNavigationItems: NavigationItem[] = [
  ...navigationItems.filter((item) => item.showInMobileNav),
  { id: 'search', label: 'Search', href: '/dashboard', icon: Search, enabled: false, showInMobileNav: true }
];

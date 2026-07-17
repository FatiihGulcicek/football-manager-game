import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Football Manager Dashboard',
  description: 'Premium football manager game dashboard foundation'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}

import { Analytics } from '@vercel/analytics/react';
import { Inter } from 'next/font/google';

import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'JWL Merge Web',
  description: 'Web application for JWL file management and merging',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
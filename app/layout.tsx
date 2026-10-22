import type { Metadata } from 'next';
import { DM_Sans, Righteous } from 'next/font/google';
import Link from 'next/link';
import { MidiStatus } from './components/MidiStatus';
import { UserPicker } from './components/UserPicker';
import './globals.css';

const righteous = Righteous({ subsets: ['latin'], weight: '400', variable: '--font-righteous' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' });

export const metadata: Metadata = {
  title: 'Piano Practice',
  description: 'Practice piano pieces from MIDI files with a MIDI keyboard.',
};

// The masthead: flat sunset stripes as sky, with a ridge line cutting across the bottom.
const RIDGE =
  '0,60 30,44 50,56 80,34 105,52 125,46 150,64 190,50 215,66 260,58 300,70 360,52 400,66 450,40 480,54 520,22 560,50 590,38 620,58 660,48 700,64 740,50 800,68';

function SunsetRidge() {
  return (
    <div className="mt-3 rounded-tl-block border-t-2 border-l-2 border-snow pt-1 pl-1">
      <svg viewBox="0 0 800 80" preserveAspectRatio="none" aria-hidden="true" className="block h-14 w-full sm:h-20">
        <rect width="800" height="20" className="fill-ember" />
        <rect y="20" width="800" height="20" className="fill-flame" />
        <rect y="40" width="800" height="31" className="fill-gold" />
        <polygon points={`${RIDGE} 800,80 0,80`} className="fill-night" />
        <polyline
          points={RIDGE}
          fill="none"
          strokeWidth="3"
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
          className="stroke-snow"
        />
      </svg>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${righteous.variable} ${dmSans.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="mx-auto max-w-4xl px-4 pt-6 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <Link href="/" className="title text-3xl hover:text-gold sm:text-4xl">
              Piano Practice
            </Link>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href="/stats" className="font-display text-sm tracking-wider uppercase hover:text-gold">
                Stats
              </Link>
              <UserPicker />
              <MidiStatus />
            </div>
          </div>
          <SunsetRidge />
        </header>
        <main className="mx-auto max-w-4xl px-4 pb-16">{children}</main>
      </body>
    </html>
  );
}

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EVIT — Enterprise VMware Intelligence Tool',
  description: 'Enterprise VMware Intelligence Tool — Infrastructure Analytics',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

export const dynamic = 'force-dynamic'

import Sidebar from '@/components/Sidebar'
import Chatbot from '@/components/Chatbot'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        {children}
      </div>
    </div>
  )
}

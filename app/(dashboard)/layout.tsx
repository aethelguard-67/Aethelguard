import type { ReactNode } from "react"
import { DashboardSidebar, MobileNav } from "@/components/dashboard-sidebar"
import { DashboardTopbar } from "@/components/dashboard-topbar"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar />
        <MobileNav />
        <main className="flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  )
}

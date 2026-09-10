import { Activity, ChartNoAxesCombined, Database, HeartPulse, Languages, LogOut, MessageCircle, Newspaper, Tags } from "lucide-react"
import { NavLink, Outlet } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useAdminAuth } from "@/lib/auth"
import { MOCK } from "@/lib/config"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/translations", label: "Translations", icon: Languages },
  // Beside Translations on purpose: same job, different storage — these strings
  // are database rows, so no locale file can reach them.
  { to: "/envars", label: "Envars", icon: Tags },
  { to: "/adherence", label: "Adherence", icon: Activity },
  { to: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/database", label: "Database", icon: Database },
  { to: "/health", label: "Health", icon: HeartPulse },
  // Development console rather than an operator tool, so it sits last —
  // below the pages somebody opens to answer a question about the product.
  { to: "/line", label: "LINE bot", icon: MessageCircle },
]

export function Layout() {
  const auth = useAdminAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r bg-muted/30 p-4">
        {/* The sidebar is 224px wide, which is why this used to read "TISH
            Admin". The full name does not fit on one line at this size, so it
            is stacked rather than abbreviated — the acronym still appears in
            body copy, but the chrome now names the product properly. */}
        <div className="mb-0 px-2 text-lg font-bold leading-tight tracking-tight">Titanium Initium</div>
        <div className="mb-1 px-2 text-xs text-muted-foreground">Smart Healthcare · Admin</div>
        <div className="mb-4 px-2">
          {MOCK && <Badge variant="secondary">mock data</Badge>}
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto">
          <Separator className="my-3" />
          <div className="truncate px-2 text-xs text-muted-foreground" title={auth.email}>
            {auth.email}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start gap-2" onClick={auth.signOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

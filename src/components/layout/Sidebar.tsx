"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  GitBranch,
  Package,
  GitFork,
  Calendar,
  Settings,
  ChevronLeft,
  ChevronRight,
  Boxes,
  Building2,
  Bell,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Overview", icon: BarChart3 },
  { href: "/github", label: "GitHub", icon: GitBranch },
  { href: "/npm", label: "npm", icon: Package },
  { href: "/pypi", label: "PyPI", icon: Boxes },
  { href: "/dependencies", label: "Dependencies", icon: GitFork },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/events", label: "Events", icon: Calendar },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://ar.io/brand/ario-white.svg"
              alt="ar.io"
              className="h-6 w-6"
            />
            <span className="text-sm font-semibold tracking-tight">
              Growth Tracker
            </span>
          </div>
        )}
        {collapsed && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src="https://ar.io/brand/ario-white.svg"
            alt="ar.io"
            className="h-5 w-5"
          />
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded-md hover:bg-sidebar-accent"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

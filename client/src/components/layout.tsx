import { Link, useLocation } from "wouter";
import { MessageSquare, GitFork, LayoutDashboard, Settings, Briefcase, Bot } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", icon: MessageSquare, label: "Messages" },
    { href: "/workflows", icon: GitFork, label: "Workflows" },
    { href: "/bot-trainer", icon: Bot, label: "Bot Trainer" },
    { href: "/onboarding", icon: Briefcase, label: "New Account" },
  ];

  return (
    <div className="min-h-screen bg-background flex font-sans text-foreground">
      {/* Sidebar */}
      <aside className="w-16 md:w-64 border-r border-sidebar-border bg-sidebar flex flex-col fixed h-full z-10">
        <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-sidebar-border">
          <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
            <LayoutDashboard className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="ml-3 font-bold text-lg hidden md:block">Nexus</span>
        </div>

        <nav className="flex-1 py-6 px-2 md:px-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                  }`}
                >
                  <item.icon
                    className={`h-5 w-5 ${
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  />
                  <span className="hidden md:block">{item.label}</span>
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <button className="flex items-center gap-3 px-3 py-2 text-muted-foreground hover:text-foreground w-full transition-colors">
            <Settings className="h-5 w-5" />
            <span className="hidden md:block">Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-16 md:ml-64 bg-background min-h-screen">
        {children}
      </main>
    </div>
  );
}

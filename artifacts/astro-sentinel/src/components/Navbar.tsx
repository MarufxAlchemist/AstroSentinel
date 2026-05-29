import { Link, useLocation } from "wouter";
import { Telescope, Search, Share2, Settings, Wifi, WifiOff, Sun, Moon } from "lucide-react";
import { useScienceMode } from "@/lib/ScienceModeContext";
import { useTheme } from "@/lib/ThemeContext";
import { NotificationBell } from "./NotificationBell";
import { ResearcherMenu } from "./ResearcherMenu";

interface NavbarProps {
  isConnected?: boolean;
}

export function Navbar({ isConnected = true }: NavbarProps) {
  const [location] = useLocation();
  const { scienceMode, toggleScienceMode } = useScienceMode();
  const { isDark, toggleTheme } = useTheme();

  return (
    <nav className="flex items-center gap-0 h-10 border-b border-border px-3 shrink-0"
      style={{ background: "hsl(var(--navbar-bg))" }}>
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4">
        <div className="bg-primary/15 p-1 rounded border border-primary/30">
          <Telescope className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm tracking-tight font-bold bg-[transparent] text-[#dee6ed]">Transmit Event Detection</span>
      </div>
      {/* Icon actions */}
      <div className="flex items-center gap-1 text-muted-foreground mr-4">
        <button className="p-1.5 rounded hover:bg-accent hover:text-foreground transition-colors" title="Search">
          <Search className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 rounded hover:bg-accent hover:text-foreground transition-colors" title="Share">
          <Share2 className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 rounded hover:bg-accent hover:text-foreground transition-colors" title="Settings">
          <Settings className="w-3.5 h-3.5" />
        </button>
        {/* Notification bell */}
        <NotificationBell />
      </div>
      {/* Nav links */}
      <div className="flex items-center gap-1 text-xs font-medium mr-auto">
        <Link
          href="/"
          className={`px-2.5 py-1 rounded transition-colors ${
            location === "/" ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Mission Control
        </Link>
        <Link
          href="/events"
          className={`px-2.5 py-1 rounded transition-colors ${
            location === "/events" || location.startsWith("/events/")
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Event Archive
        </Link>
      </div>
      {/* Science mode toggle */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4">
        <span>Science mode:</span>
        <button
          onClick={toggleScienceMode}
          title={scienceMode ? "Switch to standard view" : "Switch to researcher mode"}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 border transition-all duration-200 cursor-pointer select-none ${
            scienceMode
              ? "bg-primary/20 border-primary/50 text-primary hover:bg-primary/30"
              : "bg-muted/40 border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="relative inline-flex w-7 h-3.5 rounded-full border border-current/30 transition-colors duration-200 shrink-0"
            style={{ background: scienceMode ? "hsl(var(--primary) / 0.35)" : "hsl(var(--muted))" }}>
            <span
              className={`absolute top-0.5 w-2.5 h-2.5 rounded-full shadow transition-all duration-200 ${
                scienceMode ? "left-[calc(100%-0.75rem)] bg-primary" : "left-0.5 bg-muted-foreground/60"
              }`}
            />
          </span>
          <span className="font-medium text-[11px]">{scienceMode ? "ON" : "OFF"}</span>
        </button>
      </div>
      {/* Light / Dark mode toggle */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4">
        <button
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 border transition-all duration-200 cursor-pointer select-none bg-muted/40 border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
        >
          <span className="relative inline-flex w-7 h-3.5 rounded-full border border-current/30 transition-colors duration-200 shrink-0"
            style={{ background: isDark ? "hsl(220 40% 20%)" : "hsl(48 95% 70%)" }}>
            <span
              className={`absolute top-0.5 w-2.5 h-2.5 rounded-full shadow transition-all duration-200 ${
                isDark
                  ? "left-[calc(100%-0.75rem)] bg-slate-300"
                  : "left-0.5 bg-amber-400"
              }`}
            />
          </span>
          {isDark ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
          <span className="font-medium text-[11px]">{isDark ? "Dark" : "Light"}</span>
        </button>
      </div>
      {/* Connection status */}
      <div className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded border mr-3 ${
        isConnected
          ? "text-green-600 border-green-500/40 bg-green-500/10 dark:text-green-400 dark:border-green-400/30 dark:bg-green-400/5"
          : "text-red-600 border-red-500/40 bg-red-500/10 dark:text-red-400 dark:border-red-400/30 dark:bg-red-400/5"
      }`}>
        {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        <span>{isConnected ? "STREAM ACTIVE" : "LINK LOST"}</span>
      </div>
      {/* Researcher menu */}
      <ResearcherMenu />
      {/* Version */}
      <div className="ml-3 text-xs text-muted-foreground font-mono">
        v1.0.0
      </div>
    </nav>
  );
}

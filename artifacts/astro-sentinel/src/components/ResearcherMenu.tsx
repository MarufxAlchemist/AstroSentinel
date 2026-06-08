import { useState, useRef, useEffect } from "react";
import { User, LogOut, ChevronDown, Shield, Users } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useLocation } from "wouter";

export function ResearcherMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  if (!user) {
    return (
      <button
        onClick={() => navigate("/login")}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
      >
        <User className="w-3 h-3" />
        <span>Researcher Login</span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-primary/30 bg-primary/10 text-[11px] font-mono text-primary hover:bg-primary/20 transition-colors"
      >
        <div className="w-4 h-4 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
          <span className="text-[9px] font-bold text-primary">{user.name?.[0]?.toUpperCase() ?? user.email[0]?.toUpperCase()}</span>
        </div>
        <span className="max-w-[80px] truncate">{user.name ?? user.email.split("@")[0]}</span>
        {user.role === "admin" && <Shield className="w-2.5 h-2.5 text-primary/70" />}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 z-50 rounded border border-border shadow-xl"
          style={{ background: "hsl(var(--navbar-bg))" }}>
          {/* Profile info */}
          <div className="px-3 py-2.5 border-b border-border">
            <div className="text-[11px] font-semibold text-foreground truncate">{user.name ?? "Researcher"}</div>
            <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
            <div className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase ${user.role === "admin"
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
              }`}>
              {user.role === "admin" && <Shield className="w-2 h-2" />}
              {user.role}
            </div>
          </div>

          {/* Menu items */}
          {user.role === "admin" && (
            <button
              onClick={() => { navigate("/team"); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-accent/30 transition-colors border-b border-border/40"
            >
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Manage Research Team</span>
            </button>
          )}

          <button
            onClick={() => {
              logout();
              setOpen(false);
              navigate("/login");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

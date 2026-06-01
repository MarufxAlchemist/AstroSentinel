import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/Navbar";
import { useAstroWebSocket } from "@/hooks/useAstroWebSocket";
import { ScienceModeProvider } from "@/lib/ScienceModeContext";
import { ThemeProvider } from "@/lib/ThemeContext";
import { AuthProvider } from "@/lib/AuthContext";
import { NotificationsProvider, useNotifications } from "@/lib/NotificationsContext";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import EventsPage from "@/pages/events";
import EventDetailPage from "@/pages/event-detail";
import LoginPage from "@/pages/login";
import TeamPage from "@/pages/team";
import WebSocketDebug from "@/pages/websocket-debug";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

function Router() {
  const { isConnected, listenerAlive, gaveUp, retryCount, latestNotification } = useAstroWebSocket();
  const { addNotification } = useNotifications();

  // Forward WS notifications into context
  useEffect(() => {
    if (latestNotification) {
      addNotification(latestNotification);
    }
  }, [latestNotification]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navbar 
        isConnected={isConnected} 
        listenerAlive={listenerAlive}
        gaveUp={gaveUp}
        retryCount={retryCount}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Switch>
          <Route path="/"           component={Dashboard} />
          <Route path="/events"     component={EventsPage} />
          <Route path="/events/:id" component={EventDetailPage} />
          <Route path="/login"      component={LoginPage} />
          <Route path="/team"       component={TeamPage} />
          <Route path="/debug/ws"   component={WebSocketDebug} />
          <Route                    component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <ThemeProvider>
              <ScienceModeProvider>
                <NotificationsProvider>
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <Router />
                  </WouterRouter>
                  <Toaster />
                </NotificationsProvider>
              </ScienceModeProvider>
            </ThemeProvider>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

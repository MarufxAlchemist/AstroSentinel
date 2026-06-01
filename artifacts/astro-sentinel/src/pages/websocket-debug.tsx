import React, { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, AlertCircle, Wifi, WifiOff } from "lucide-react";

interface LogMessage {
  id: number;
  timestamp: Date;
  direction: "in" | "out" | "system";
  data: string;
}

export default function WebSocketDebug() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "reconnecting">("disconnected");
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);

  const addLog = (direction: "in" | "out" | "system", data: string) => {
    setLogs((prev) => {
      const newLogs = [...prev, { id: logIdCounter.current++, timestamp: new Date(), direction, data }];
      // Keep last 1000 messages to prevent memory leak
      return newLogs.slice(-1000);
    });
  };

  const connect = (isReconnect = false) => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setStatus(isReconnect ? "reconnecting" : "connecting");
    addLog("system", `Attempting connection to /api/ws?v=1...`);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?v=1`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      addLog("system", "WebSocket connected");
    };

    ws.onmessage = (event) => {
      // We purposefully don't parse it so we can see the exact raw payload
      addLog("in", event.data);
    };

    ws.onclose = (event) => {
      setStatus("disconnected");
      addLog("system", `WebSocket closed (code: ${event.code})`);
      
      // Auto reconnect
      if (event.code !== 1000) {
        setStatus("reconnecting");
        addLog("system", "Scheduling reconnect in 2s...");
        reconnectTimeoutRef.current = setTimeout(() => {
          connect(true);
        }, 2000);
      }
    };

    ws.onerror = (error) => {
      addLog("system", `WebSocket error occurred`);
    };
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (wsRef.current) {
      addLog("system", "Closing connection intentionally...");
      wsRef.current.close(1000);
    }
  };

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (logContainerRef.current) {
      const scrollableNode = logContainerRef.current;
      scrollableNode.scrollTop = scrollableNode.scrollHeight;
    }
  }, [logs]);

  const clearLogs = () => setLogs([]);

  return (
    <div className="flex flex-col h-full bg-background p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          WebSocket Debugger
        </h1>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border font-mono text-sm ${
            status === "connected" ? "bg-green-500/10 text-green-600 border-green-500/20" :
            status === "reconnecting" || status === "connecting" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
            "bg-red-500/10 text-red-600 border-red-500/20"
          }`}>
            {status === "connected" ? <Wifi className="w-4 h-4" /> : 
             status === "reconnecting" || status === "connecting" ? <Activity className="w-4 h-4 animate-pulse" /> :
             <WifiOff className="w-4 h-4" />}
            {status.toUpperCase()}
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => status === "disconnected" ? connect() : disconnect()}
              className="px-3 py-1 text-sm bg-primary/10 text-primary border border-primary/20 rounded hover:bg-primary/20 transition-colors"
            >
              {status === "disconnected" ? "Connect" : "Disconnect"}
            </button>
            <button 
              onClick={clearLogs}
              className="px-3 py-1 text-sm bg-muted text-muted-foreground border rounded hover:bg-accent transition-colors"
            >
              Clear Logs
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 border rounded-lg bg-[#0d1117] overflow-hidden flex flex-col">
        <div className="flex bg-[#161b22] px-4 py-2 border-b border-white/10 text-xs font-mono text-muted-foreground">
          <div className="w-24 shrink-0">TIME</div>
          <div className="w-20 shrink-0">DIR</div>
          <div className="flex-1">PAYLOAD</div>
        </div>
        
        <div 
          ref={logContainerRef} 
          className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-2 scrollbar-thin"
        >
          {logs.length === 0 ? (
            <div className="text-muted-foreground text-center mt-10">No messages yet.</div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="flex gap-4 group hover:bg-white/5 p-1 -m-1 rounded transition-colors break-words">
                <div className="w-24 shrink-0 text-muted-foreground/60">
                  {log.timestamp.toLocaleTimeString([], { hour12: false, fractionalSecondDigits: 3 })}
                </div>
                
                <div className={`w-20 shrink-0 font-bold ${
                  log.direction === "in" ? "text-blue-400" :
                  log.direction === "out" ? "text-green-400" :
                  "text-amber-500"
                }`}>
                  {log.direction === "in" ? "RX ←" : log.direction === "out" ? "TX →" : "SYS •"}
                </div>
                
                <div className="flex-1 text-[#c9d1d9] break-all whitespace-pre-wrap">
                  {log.data}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

import React, { createContext, useContext, useState } from "react";

interface ScienceModeContextType {
  scienceMode: boolean;
  toggleScienceMode: () => void;
}

const ScienceModeContext = createContext<ScienceModeContextType>({
  scienceMode: false,
  toggleScienceMode: () => {},
});

export function ScienceModeProvider({ children }: { children: React.ReactNode }) {
  const [scienceMode, setScienceMode] = useState(false);
  const toggleScienceMode = () => setScienceMode(prev => !prev);
  return (
    <ScienceModeContext.Provider value={{ scienceMode, toggleScienceMode }}>
      {children}
    </ScienceModeContext.Provider>
  );
}

export function useScienceMode() {
  return useContext(ScienceModeContext);
}

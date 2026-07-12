"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { EMPTY_DATA, type FreeloomData } from "./types";

const STORAGE_KEY = "freeloom-data-v1";

type StoreContextValue = {
  data: FreeloomData;
  setData: (updater: FreeloomData | ((prev: FreeloomData) => FreeloomData)) => void;
  hydrated: boolean;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<FreeloomData>(EMPTY_DATA);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // One-time hydration from localStorage on mount; this reads an external
    // system (the browser's storage) into React state, which is exactly what
    // effects are for, so the initial synchronous setState here is intentional.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDataState({ ...EMPTY_DATA, ...JSON.parse(raw) });
      }
    } catch {
      // corrupt or inaccessible storage: start fresh
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  return (
    <StoreContext.Provider value={{ data, setData: setDataState, hydrated }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

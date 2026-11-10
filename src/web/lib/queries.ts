import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AiServerStatus, HomeView } from "../../shared/api";
import type { HearthConfig } from "../../shared/config";
import { api } from "./api";
import { live } from "./live";

export const keys = {
  home: ["home"] as const,
  admin: ["admin-config"] as const,
  servers: ["ai-servers"] as const,
};

export const useHome = () =>
  useQuery({ queryKey: keys.home, queryFn: () => api.get<HomeView>("/api/home") });

export interface AdminConfig {
  config: HearthConfig;
  secrets: string[];
  keyInDataDir: boolean;
  pins: Record<string, boolean>;
}

export const useAdminConfig = (enabled = true) =>
  useQuery({
    queryKey: keys.admin,
    queryFn: () => api.get<AdminConfig>("/api/admin/config"),
    enabled,
    retry: false,
  });

export const useServers = (enabled = true) =>
  useQuery({
    queryKey: keys.servers,
    queryFn: () => api.get<AiServerStatus[]>("/api/ai/servers"),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });

/** When the config or session changes anywhere (another device, the admin), refetch. */
export function useLiveRefresh(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      live.changes(() => {
        void qc.invalidateQueries({ queryKey: keys.home });
        void qc.invalidateQueries({ queryKey: keys.admin });
      }),
    [qc],
  );
}

/** Refresh everything that depends on who's signed in or what's configured. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

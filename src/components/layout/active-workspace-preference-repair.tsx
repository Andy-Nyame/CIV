"use client";

import { startTransition, useEffect } from "react";

import { repairActiveWorkspacePreferenceAction } from "@/features/workspaces/actions";

export function ActiveWorkspacePreferenceRepair({
  currentWorkspaceId,
  needed,
}: {
  currentWorkspaceId: string | null;
  needed: boolean;
}) {
  useEffect(() => {
    if (!needed) return;

    startTransition(() => {
      void repairActiveWorkspacePreferenceAction(currentWorkspaceId);
    });
  }, [currentWorkspaceId, needed]);

  return null;
}

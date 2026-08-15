export type WorkspaceOption = {
  id: string;
  name: string;
  type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION";
  role: "OWNER" | "ADMIN" | "MANAGER" | "STAFF";
};

export type WorkspaceContext = {
  current: WorkspaceOption | null;
  available: WorkspaceOption[];
  preferenceNeedsRepair: boolean;
};

export type WorkspaceFormState = {
  message?: string;
  fieldErrors?: {
    type?: string[];
    name?: string[];
  };
};

export const initialWorkspaceFormState: WorkspaceFormState = {};

export type WorkspaceSettingsFormState = {
  success?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const initialWorkspaceSettingsFormState: WorkspaceSettingsFormState = {};

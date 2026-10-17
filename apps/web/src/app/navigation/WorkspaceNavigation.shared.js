import { createContext, useContext } from "react";

export const WorkspaceNavigation = createContext(null);
export const useWorkspaceNavigation = () => useContext(WorkspaceNavigation);

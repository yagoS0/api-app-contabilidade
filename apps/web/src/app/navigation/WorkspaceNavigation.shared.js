import { createContext, useContext, useId, useLayoutEffect, useMemo } from "react";

export const WorkspaceNavigation = createContext(null);
export const useWorkspaceNavigation = () => useContext(WorkspaceNavigation);

// The registration owns no document content. Context changes replace the lease;
// ordinary renders update operations without removing another editor's lease.
export function useWorkspaceEditor(editor) {
  const workspace = useWorkspaceNavigation();
  const id = useId();
  const latest = useMemo(() => ({ current: editor }), [editor.context]);
  latest.current = editor;
  const register = workspace?.registerEditor;
  useLayoutEffect(() => {
    if (!register) return undefined;
    return register(id, () => latest.current);
  }, [register, id, latest]);
  return workspace;
}

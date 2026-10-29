import { oNavegadorAssumeOClique } from "../../components/ui/cliqueDeLink";

// Only the workspace's same-tab fallback differs: Meta is not a new-tab shortcut
// on Windows/Linux. Keep the shared link policy and the portal mirror untouched.
export function oNavegadorAssumeCliqueNoWorkspace(event, environment = typeof navigator === "undefined" ? null : navigator) {
  const hint = environment?.userAgentData?.platform;
  const platform = typeof hint === "string" && hint.trim() ? hint.trim() : environment?.platform;
  const apple = typeof platform === "string" && /^(?:Mac|macOS|MacIntel|MacPPC|Mac68K|Macintosh|iPhone|iPad|iPod)$/i.test(platform.trim());
  return oNavegadorAssumeOClique({
    defaultPrevented: event.defaultPrevented,
    button: event.button,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: Boolean(event.metaKey) && apple,
  });
}
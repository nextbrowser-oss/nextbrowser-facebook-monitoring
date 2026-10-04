// The browser surface the monitor needs.
//
// It is a subset of the X reply engine's XBrowser in nextbrowser-app
// (src/lib/xreply/browser.ts), so the app can hand the monitor the same
// nextctl-backed browser it already builds for a prepared profile. Outside the
// app, src/node/nbc.ts implements it over the nbc CLI.
//
// Facebook is read from the pages it draws, not from data: a group's content
// is gated behind a signed-in member, and Facebook's own data calls are signed
// per session and change with every release. So the monitor opens the group
// page, waits until Facebook has drawn the feed, and reads it through the DOM:
// a tab, a way to navigate it, a way to wait, and a way to evaluate a script.
//
// Nothing here may depend on Node: the app runs its engines in the renderer.

export interface MonitorBrowser {
  /** Navigate the active tab. */
  open(url: string): Promise<void>;
  /** Evaluate one expression on the active page and return its value. The
   *  label names the read in logs and lets test fakes route by it; the script
   *  itself would be pages long. */
  evaluate<T>(script: string, label?: string): Promise<T>;
  /** Wait until the active page finishes loading. */
  waitForLoad(timeoutSeconds?: number): Promise<void>;
}

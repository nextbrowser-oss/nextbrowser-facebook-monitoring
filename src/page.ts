// Loading one facebook.com page and making sure it was actually drawn.
//
// The load event fires long before Facebook draws anything: the page is a
// shell, and the feed arrives from requests Facebook's own app makes after
// it. A read that does not wait meets an empty page, and an empty page reads
// exactly like a group with no posts. So after the load the page is polled,
// bounded, until what it was opened for is drawn — or until it turns out to
// be one of the screens in front of it (sign-in, security check, block, not a
// member), which ends the wait just as well. (The X monitor's src/page.ts,
// without its fresh-tab repair: Facebook's fallback is m.facebook.com.)

import type { MonitorBrowser } from "./browser.js";
import type { Logger } from "./log.js";
import { existsScript, pageHealthScript, type PageHealth } from "./scripts.js";

const LOAD_WAIT_SECONDS = 20;
/** How long Facebook is given to draw what the page was opened for, after the
 *  document has loaded. Everything waited for here is Facebook's own data
 *  calls, through the profile's proxy. */
export const READY_WAIT_MS = 20_000;
const POLL_MS = 500;

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** waitForElement asks the page whether anything matches the selector, or
 *  whether a gate is up, until one is or the time is up. It reports whether it
 *  was found; running out of time is an answer, not an error. */
export async function waitForElement(
  browser: MonitorBrowser,
  selector: string,
  timeoutMs: number,
  sleep: Sleep,
  now: () => number = Date.now,
): Promise<boolean> {
  const script = existsScript(selector);
  const deadline = now() + timeoutMs;
  for (;;) {
    const answer = await browser.evaluate<{ found?: boolean }>(script, "exists").catch(() => undefined);
    if (answer?.found) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(POLL_MS, remaining));
  }
}

export interface LoadOptions {
  sleep: Sleep;
  log: Logger;
  now?: () => number;
  /** How long to wait for the ready selector. */
  readyMs?: number;
}

/** loadPage opens a URL, waits for Facebook to draw it, and says what the
 *  page shows. Neither wait is fatal: a page that draws nothing is exactly
 *  what the health read exists to say. */
export async function loadPage(
  browser: MonitorBrowser,
  url: string,
  readySelector: string,
  options: LoadOptions,
): Promise<PageHealth> {
  const now = options.now ?? Date.now;
  const started = now();
  await browser.open(url);
  await browser.waitForLoad(LOAD_WAIT_SECONDS).catch(() => undefined);
  await waitForElement(browser, readySelector, options.readyMs ?? READY_WAIT_MS, options.sleep, now);
  let health = await browser.evaluate<PageHealth>(pageHealthScript(), "health");
  if (health.hidden && browser.bringToFront) {
    // A hidden page gets its first post drawn and no more; brought to the
    // front, it loads the feed as it is scrolled (live, 2026-10-09).
    await browser.bringToFront().catch((error: unknown) => options.log("front_failed", { error: String(error) }));
    health = await browser.evaluate<PageHealth>(pageHealthScript(), "health");
    options.log("brought_to_front", { url: health.url, hidden: health.hidden === true });
  }
  options.log("page", {
    wanted: url,
    url: health.url,
    host: health.host,
    rendered: health.rendered,
    articles: health.articles,
    gate: health.gate,
    ms: now() - started,
    ...(health.diag ? { diag: health.diag } : {}),
  });
  return health;
}

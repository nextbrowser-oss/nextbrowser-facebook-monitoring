// Facebook group, post and comment ids, and the links built from them.
//
// A group is named by its numeric id or by the vanity name its admins chose
// ("acme.users"); facebook.com accepts either in /groups/<id>/. A post id is
// a digit string, too wide for a JavaScript number, or one of the opaque
// "pfbid…" ids newer permalinks carry; both are kept as strings and never
// parsed. Facebook links a group post in several shapes, and a post is the
// same post in all of them:
//
//   /groups/<group>/posts/<post>/
//   /groups/<group>/permalink/<post>/
//   /groups/<group>/?multi_permalinks=<post>
//   /permalink.php?story_fbid=<post>&id=<group>
//   /story.php?story_fbid=<post>&id=<group>        (m.facebook.com)

const GROUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const POST = /^(?:\d{1,25}|pfbid[A-Za-z0-9]{10,80})$/;
const COMMENT = /^\d{1,25}$/;

/** normalizeGroup accepts a group id, a vanity name or a group link in any
 *  form a person pastes it, and returns the id or vanity name, or "" for
 *  anything that cannot be one. */
export function normalizeGroup(value: unknown): string {
  let text = String(value ?? "").trim();
  const link = /^(?:https?:\/\/)?(?:(?:www|m|web|mbasic)\.)?facebook\.com\/groups\/([^/?#\s]+)/i.exec(text);
  if (link) text = link[1] ?? "";
  else if (/[/:?#\s]/.test(text)) return "";
  try {
    text = decodeURIComponent(text);
  } catch {
    return "";
  }
  return GROUP.test(text) ? text : "";
}

/** groupKey is how a group is keyed in the state: case does not tell two
 *  vanity names apart. */
export function groupKey(group: string): string {
  return `group:${group.toLowerCase()}`;
}

/** groupUrl is the link to a group. */
export function groupUrl(group: string): string {
  return `https://www.facebook.com/groups/${group}/`;
}

/** feedUrl is the group's feed with the newest posts first. Without the
 *  sorting setting Facebook shows "Most relevant", which reorders old posts
 *  above new ones and makes a feed position mean nothing. */
export function feedUrl(group: string): string {
  return `https://www.facebook.com/groups/${group}/?sorting_setting=CHRONOLOGICAL`;
}

/** mobileFeedUrl is the same group on m.facebook.com, the fallback. */
export function mobileFeedUrl(group: string): string {
  return `https://m.facebook.com/groups/${group}/`;
}

/** postUrl is the link to a post in a group. */
export function postUrl(group: string, postId: string): string {
  return `https://www.facebook.com/groups/${group}/posts/${postId}/`;
}

/** commentUrl is the link to one comment under a post. Facebook opens the
 *  post and scrolls to the comment. */
export function commentUrl(group: string, postId: string, commentId: string): string {
  return `${postUrl(group, postId)}?comment_id=${commentId}`;
}

/** normalizePostId keeps a post id that looks like one. */
export function normalizePostId(value: unknown): string {
  const text = String(value ?? "").trim();
  return POST.test(text) ? text : "";
}

/** normalizeCommentId keeps a comment id that looks like one. */
export function normalizeCommentId(value: unknown): string {
  const text = String(value ?? "").trim();
  return COMMENT.test(text) ? text : "";
}

/** postIdFromUrl reads the post id out of any of the permalink shapes above. */
export function postIdFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://www.facebook.com/");
  } catch {
    return "";
  }
  const path = /\/groups\/[^/]+\/(?:posts|permalink)\/([^/?#]+)/.exec(parsed.pathname);
  if (path) return normalizePostId(path[1]);
  return normalizePostId(parsed.searchParams.get("multi_permalinks")?.split(",")[0] ?? parsed.searchParams.get("story_fbid") ?? "");
}

// Renders assets/facebook-monitor-terminal.svg, the terminal shown at the top
// of the README. Every line comes from the CLI's own formatters
// (dist/node/cli.js), so the picture shows exactly what `facebook-monitor run`
// prints; the groups, people, posts and numbers are sample data.
//
//   npm run build && npm run render:terminal

import { writeFile } from "node:fs/promises";
import { describeEvent, describePass } from "../dist/node/cli.js";

const at = (hour, minute) => new Date(2026, 9, 5, hour, minute).getTime();
const groups = {
  acme: { id: "acme.users", name: "Acme Users", url: "https://www.facebook.com/groups/acme.users/" },
  saas: { id: "indiesaas", name: "Indie SaaS Founders", url: "https://www.facebook.com/groups/indiesaas/" },
};
const postLink = (group, id) => `https://www.facebook.com/groups/${group.id}/posts/${id}/`;
const post = (group, id, author, text) => ({ id, url: postLink(group, id), author, text });
const item = (kind, group, parent, id, author, text, extra = {}) => ({
  key: `${kind}:${id}`, id, kind, author, text, group, post: parent,
  url: kind === "post" ? parent.url : `${parent.url}?comment_id=${id}`,
  ...extra,
});
const found = (time, value, urgency, reasons, keywords = ["acme"]) => ({
  type: "new_item", at: time, account: "Dana Reyes", item: value, keywords, triage: { urgency, score: 0, reasons },
  source: { kind: value.kind === "post" ? "group_post" : "group_comment", name: value.group.name, group: value.group.id },
});
const pass = (patch) => ({
  signedIn: true, account: "Dana Reyes", loginRequired: false, securityCheck: false, rateLimited: false, pagesLoaded: 0,
  groupsRead: 2, baselines: 0, fallbacks: 0, unreadable: 0, postsRead: 0, scrolls: 0, matches: 0, newItems: 0, urgent: 0,
  commentReads: 0, commentReadsDeferred: 0, stopped: false, notes: [], ...patch,
});

const down = post(groups.acme, "1029384756", "Mila Novak", "Is Acme down for anyone else? Can't log in since noon");
const billing = post(groups.acme, "1029384701", "Lee Park", "Has anyone tried Acme for team billing?");
const tools = post(groups.saas, "2047113920", "Sam Ortiz", "What is everyone using for invoicing these days?");
const lead = post(groups.saas, "2047113988", "Ana Lima", "Looking for an alternative to Acme for invoicing, any suggestions?");

const lines = [
  describeEvent({ type: "signed_in", at: at(9, 0), name: "Dana Reyes", id: "100001" }),
  describePass(pass({ baselines: 2, matches: 5 }), at(9, 0)),
  describeEvent(found(at(9, 30), item("post", groups.acme, down, down.id, down.author, down.text, { replies: 3 }),
    "high", ['Says "can\'t log in"', "Asks a question"])),
  describeEvent(found(at(9, 30), item("comment", groups.acme, billing, "1048576", "Kim Ito", "Dana Reyes can you check the billing export?", { addressed: "mention" }),
    "high", ["Mentions you", "Asks a question"], [])),
  describeEvent(found(at(9, 30), item("post", groups.saas, lead, lead.id, lead.author, lead.text, { replies: 2 }),
    "medium", ["Asks a question", "Asks for a recommendation"])),
  describeEvent(found(at(9, 30), item("comment", groups.saas, tools, "2051000", "Bo Chen", "We moved to acme last year, no complaints"),
    "low", [])),
  describePass(pass({ matches: 9, newItems: 4, urgent: 2, commentReads: 2 }), at(9, 30)),
];

const COLORS = {
  background: "#0b1120",
  bar: "#111827",
  border: "#1f2937",
  text: "#e5e7eb",
  dim: "#6b7280",
  prompt: "#2dd4bf",
  high: "#f87171",
  medium: "#fbbf24",
  low: "#94a3b8",
  counts: "#60a5fa",
  pass: "#94a3b8",
  user: "#c4b5fd",
  group: "#5eead4",
  reasons: "#a7f3d0",
  link: "#64748b",
};

const PEOPLE = ["Dana Reyes", "Mila Novak", "Kim Ito", "Ana Lima", "Bo Chen", "Sam Ortiz", "Lee Park"];
const GROUPS = Object.values(groups).map((group) => group.name);
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TOKEN = new RegExp(
  `(\\bHIGH\\b|\\bMEDIUM\\b|(?<=^\\s{2})low\\b|\\bsigned in\\b|\\bpass(?= )|https:\\/\\/\\S+|\\[[^\\]]*\\]|${GROUPS.map(literal).join("|")}|${PEOPLE.map(literal).join("|")})`,
  "g",
);

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colorOf(token) {
  if (token === "HIGH") return COLORS.high;
  if (token === "MEDIUM") return COLORS.medium;
  if (token === "low") return COLORS.low;
  if (token === "signed in") return COLORS.counts;
  if (token === "pass") return COLORS.pass;
  if (token.startsWith("https://")) return COLORS.link;
  if (token.startsWith("[")) return COLORS.reasons;
  if (GROUPS.includes(token)) return COLORS.group;
  if (PEOPLE.includes(token)) return COLORS.user;
  return COLORS.dim;
}

function spans(line) {
  const time = line.slice(0, 5);
  const rest = line.slice(5);
  const parts = [`<tspan fill="${COLORS.dim}">${escape(time)}</tspan>`];
  let last = 0;
  for (const match of rest.matchAll(TOKEN)) {
    if (match.index > last) parts.push(escape(rest.slice(last, match.index)));
    parts.push(`<tspan fill="${colorOf(match[0])}">${escape(match[0])}</tspan>`);
    last = match.index + match[0].length;
  }
  parts.push(escape(rest.slice(last)));
  return parts.join("");
}

// An event or a pass carries its details on the lines under it.
const rowsText = lines.flatMap((line) => line.split("\n"));
const FONT_SIZE = 14;
const LINE = 26;
const CHAR = FONT_SIZE * 0.6;
const PAD = 28;
const BAR = 40;
const command = "$ facebook-monitor run --profile acme --groups acme.users,indiesaas --keywords acme";
const longest = Math.max(command.length, ...rowsText.map((line) => line.length));
const width = Math.ceil(PAD * 2 + longest * CHAR);
const height = BAR + PAD + LINE * (rowsText.length + 1) + PAD - 6;

const rows = [
  `<text x="${PAD}" y="${BAR + PAD + 4}"><tspan fill="${COLORS.prompt}">$</tspan> ${escape(command.slice(2))}</text>`,
  ...rowsText.map((line, index) => `<text x="${PAD}" y="${BAR + PAD + 4 + LINE * (index + 1)}" xml:space="preserve">${spans(line)}</text>`),
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Example facebook-monitor output: group posts and comments that name a keyword or mention the account, ranked by urgency, each with its group and a direct link">
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <path d="M12.5 0.5h${width - 25}a12 12 0 0 1 12 12v${BAR - 12}h-${width - 1}v-${BAR - 12}a12 12 0 0 1 12-12z" fill="${COLORS.bar}"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="44" cy="20" r="6" fill="#febc2e"/>
  <circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="25" text-anchor="middle" fill="${COLORS.dim}" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">facebook-monitor — sample output</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT_SIZE}" fill="${COLORS.text}">
    ${rows.join("\n    ")}
  </g>
</svg>
`;

await writeFile(new URL("../assets/facebook-monitor-terminal.svg", import.meta.url), svg);
console.log(`assets/facebook-monitor-terminal.svg: ${width}x${height}, ${rowsText.length} lines`);
for (const line of rowsText) console.log(line);

import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USER || "leventtcaan";
const token = process.env.GITHUB_TOKEN || "";
const apiHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${username}-profile-metrics`,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers: apiHeaders });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function graphql(query, variables) {
  if (!token) return null;
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...apiHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GraphQL: ${response.status} ${await response.text()}`);
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const repos = (await github(`/users/${username}/repos?type=owner&sort=pushed&per_page=100`))
  .filter((repo) => !repo.fork && !repo.archived && repo.name !== username);

const languageRows = await Promise.all(repos.map(async (repo) => {
  try {
    return await github(`/repos/${username}/${repo.name}/languages`);
  } catch {
    return {};
  }
}));

const languageTotals = new Map();
for (const row of languageRows) {
  for (const [language, bytes] of Object.entries(row)) {
    languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
  }
}

const languages = [...languageTotals.entries()].sort((a, b) => b[1] - a[1]);
const totalBytes = languages.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
const topLanguages = languages.slice(0, 6).map(([name, bytes]) => ({
  name,
  bytes,
  percentage: (bytes / totalBytes) * 100,
}));

const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 365);
const contributionQuery = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount date } }
        }
      }
    }
  }
`;

let contributions = null;
try {
  const data = await graphql(contributionQuery, {
    login: username,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  contributions = data?.user?.contributionsCollection || null;
} catch (error) {
  console.warn(`Contribution metrics unavailable: ${error.message}`);
}

const days = contributions?.contributionCalendar?.weeks.flatMap((week) => week.contributionDays) || [];
const activeDays = days.filter((day) => day.contributionCount > 0).length;
const weeklyTotals = (contributions?.contributionCalendar?.weeks || [])
  .slice(-16)
  .map((week) => week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0));
const maxWeek = Math.max(...weeklyTotals, 1);
const contributionTotal = contributions?.contributionCalendar?.totalContributions ?? "—";
const collaborationTotal = contributions
  ? contributions.totalPullRequestContributions + contributions.totalPullRequestReviewContributions
  : "—";

const colors = {
  Java: "#e76f00",
  Python: "#3776ab",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  HTML: "#e34c26",
  CSS: "#663399",
  Shell: "#89e051",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  "Jupyter Notebook": "#da5b0b",
  default: "#225cff",
};

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const statCard = (x, label, value, accent) => `
  <g transform="translate(${x} 86)">
    <rect width="220" height="88" rx="12" fill="#fffef8" stroke="#101113" stroke-opacity=".16"/>
    <rect width="6" height="88" rx="3" fill="${accent}"/>
    <text x="24" y="32" class="label">${escapeXml(label)}</text>
    <text x="24" y="67" class="value">${escapeXml(value)}</text>
  </g>`;

let stackedX = 52;
const stack = topLanguages.map((language, index) => {
  const width = index === topLanguages.length - 1
    ? Math.max(0, 896 - (stackedX - 52))
    : Math.max(3, 896 * (language.percentage / 100));
  const block = `<rect x="${stackedX.toFixed(1)}" y="242" width="${width.toFixed(1)}" height="18" fill="${colors[language.name] || colors.default}"/>`;
  stackedX += width;
  return block;
}).join("");

const languageLegend = topLanguages.map((language, index) => {
  const column = index % 3;
  const row = Math.floor(index / 3);
  const x = 55 + column * 292;
  const y = 295 + row * 38;
  return `
    <g transform="translate(${x} ${y})">
      <circle cx="6" cy="-4" r="6" fill="${colors[language.name] || colors.default}"/>
      <text x="22" y="0" class="lang">${escapeXml(language.name)}</text>
      <text x="250" y="0" class="percent" text-anchor="end">${language.percentage.toFixed(1)}%</text>
    </g>`;
}).join("");

const pulseBars = weeklyTotals.map((value, index) => {
  const height = Math.max(3, 50 * (value / maxWeek));
  const x = 585 + index * 22;
  return `<rect x="${x}" y="${408 - height}" width="12" height="${height}" rx="3" fill="${index === weeklyTotals.length - 1 ? "#ff5c35" : "#225cff"}" opacity="${0.35 + (index / Math.max(weeklyTotals.length - 1, 1)) * 0.65}"/>`;
}).join("");

const updated = to.toISOString().slice(0, 10);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="450" viewBox="0 0 1000 450" role="img" aria-labelledby="title desc">
  <title id="title">Levent Can Ceylan live engineering signal</title>
  <desc id="desc">Automatically generated contribution, collaboration, repository and public language metrics.</desc>
  <style>
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .sans { font-family: Arial, Helvetica, sans-serif; }
    .label { font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 1.2px; fill: #4c4e52; }
    .value { font: 700 28px Arial, Helvetica, sans-serif; fill: #101113; }
    .lang { font: 700 12px Arial, Helvetica, sans-serif; fill: #101113; }
    .percent { font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #4c4e52; }
  </style>
  <rect x="1" y="1" width="998" height="448" rx="16" fill="#f2f0e9" stroke="#101113" stroke-opacity=".2"/>
  <text x="38" y="43" class="mono" font-size="12" font-weight="700" letter-spacing="1.7" fill="#101113">LIVE ENGINEERING SIGNAL</text>
  <circle cx="274" cy="39" r="5" fill="#c8ff3d" stroke="#101113" stroke-width="1"/>
  <text x="962" y="43" class="mono" font-size="10" letter-spacing="1.3" text-anchor="end" fill="#4c4e52">AUTO-REFRESHED / ${updated}</text>
  <path d="M0 63H1000" stroke="#101113" stroke-opacity=".14"/>

  ${statCard(38, "CONTRIBUTIONS / 365D", contributionTotal, "#225cff")}
  ${statCard(273, "ACTIVE DAYS / 365D", activeDays || "—", "#ff5c35")}
  ${statCard(508, "PRS + REVIEWS / 365D", collaborationTotal, "#c8ff3d")}
  ${statCard(743, "PUBLIC REPOSITORIES", repos.length, "#101113")}

  <text x="52" y="217" class="mono" font-size="10" font-weight="700" letter-spacing="1.4" fill="#101113">PUBLIC CODE FOOTPRINT / LANGUAGE BYTES</text>
  <clipPath id="stackClip"><rect x="52" y="242" width="896" height="18" rx="9"/></clipPath>
  <g clip-path="url(#stackClip)">${stack}</g>
  ${languageLegend}

  <path d="M38 371H962" stroke="#101113" stroke-opacity=".14"/>
  <text x="52" y="405" class="mono" font-size="10" font-weight="700" letter-spacing="1.4" fill="#101113">16-WEEK CONTRIBUTION PULSE</text>
  ${pulseBars}
  <text x="948" y="431" class="mono" font-size="9" text-anchor="end" fill="#4c4e52">OLDER → CURRENT</text>
</svg>`;

await mkdir("assets", { recursive: true });
await writeFile("assets/code-footprint.svg", svg);
console.log(`Generated metrics for ${repos.length} repositories and ${languages.length} languages.`);

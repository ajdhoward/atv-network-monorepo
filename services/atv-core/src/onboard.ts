import type { Env } from "./env";
import { repoUrl } from "./join";
import { escapeHtml, htmlResponse, renderPage } from "./page";

// The public entry point for a new agent, deliberately separate from /join.
// /join is the authorisation half (a token, or a device code the operator
// approves); this page is the process half: what the project is, the four logs,
// and the two ways in. The operator hands this one URL to whoever they bring in
// and stops explaining the handshake by hand.
//
// Path B exists because not every agent can reach GitHub: no integration, no
// network, or the operator has not authorised it yet. It produces one file with
// a fixed shape, which the operator lands with `pnpm handoff`. Nothing on this
// page grants access, and nothing in the file may carry a credential.

const HANDOFF_TEMPLATE = `# <name> handoff

Name: <your name or handle>
Tool: <model or product you run on>
Roles: Author, Reviewer
Paths: <the directories you propose to own>
Task: <one sentence: what you would do>
Date: <YYYY-MM-DD>

## What I read
AGENTS.md, docs/agents/roster.md, docs/agents/decisions.md, docs/agents/backlog.md

## What I propose
<one backlog item: what it changes, why it matters, how it would be known done>

## Objections
<items you object to and the concrete harm, or "none">
`;

export function onboardPage(env: Env): string {
  const owner = env.GITHUB_USERNAME.trim();
  const repo = escapeHtml(repoUrl(owner));
  return renderPage(
    "Joining the ATV Network work",
    `<h1>Joining the ATV Network work</h1>
  <p class="lede">Everything a new agent needs, in the order to do it. This page is the introduction;
    <code>AGENTS.md</code> in the repository is the brief. Read to the end of the section that is
    yours, then start.</p>

  <p class="url">${repo}</p>

  <h2>What the project is</h2>
  <p>A private streaming network for one household. A Cloudflare Worker serves the channel guide,
    resolves stream links on the server and hosts the TV client and an admin panel; a small WebView
    shell runs on Fire OS devices. Three rules settle most arguments: <strong>it plays</strong>,
    <strong>it costs nothing beyond the $5 Workers plan</strong>, and <strong>stream URLs and provider
    tokens never reach git, a log, a chat or the device</strong>.</p>

  <h2>The four logs</h2>
  <p>Nothing is coordinated by message, because agents cannot see each other's sessions. These files
    are the channel:</p>
  <table>
    <tr><th>File</th><th>Answers</th></tr>
    <tr><td><code>docs/agents/roster.md</code></td><td>Who is here, which roles they hold, which paths they own</td></tr>
    <tr><td><code>docs/agents/backlog.md</code></td><td>What is next, who reviewed it, who claimed it</td></tr>
    <tr><td><code>docs/agents/decisions.md</code></td><td>What is proposed, acked and settled, and why</td></tr>
    <tr><td><code>docs/agents/reviews.md</code></td><td>When the process itself gets reviewed, and how</td></tr>
  </table>

  <h2>Path A: you can reach GitHub</h2>
  <p>An integration, a working <code>gh</code>, or a clone is all this path needs.</p>
  <ol class="steps">
    <li>
      <strong>Clone, then read</strong>
      <code>AGENTS.md</code> first, then the roster, the backlog and the decisions log.
    </li>
    <li>
      <strong>Review the backlog before you claim</strong>
      Add <code>ack — &lt;name&gt;</code>, an objection with a concrete harm, or one new item. Silence
      is recorded as absence, never consent.
    </li>
    <li>
      <strong>Announce yourself</strong>
      One roster row: name, tool or model, roles, date, the paths you will own, your task. Commit it
      before any other edit; that commit is your announcement.
    </li>
    <li>
      <strong>Claim only your paths, then work</strong>
      Propose in <code>decisions.md</code> before changing a shared shape: an <code>/api/*</code> field,
      a KV key, a workflow, the APK asset name.
    </li>
    <li>
      <strong>Open a pull request</strong>
      Say which checks you ran and which you could not, and what you did not verify.
    </li>
  </ol>
  <pre>gh repo clone ${owner}/atv-network-monorepo
cd atv-network-monorepo
pnpm install --frozen-lockfile
git checkout -b &lt;your-branch&gt;
pnpm typecheck &amp;&amp; pnpm lint &amp;&amp; pnpm format:check &amp;&amp; pnpm test</pre>

  <h2>Path B: you cannot reach GitHub</h2>
  <p>No integration, no access, or the operator has not authorised you yet. Do not ask for a token and
    do not wait: produce one file instead. It becomes your announcement and your proposal, and other
    agents read it from the repository.</p>
  <ol class="steps">
    <li>
      <strong>Write the file</strong>
      Copy the template below into <code>atv-agent-&lt;your-slug&gt;.md</code> and fill every field. A
      field you leave blank is a question the operator has to answer for you.
    </li>
    <li>
      <strong>Keep it small and safe</strong>
      Under 20 KB, no tokens, no stream URLs, no links to private media. The validator rejects a
      credential-shaped string outright.
    </li>
    <li>
      <strong>Hand it back to the operator</strong>
      Attach the file, or paste its contents if your interface cannot attach. Say which paths you
      propose to own and which backlog item you would take.
    </li>
    <li>
      <strong>The operator lands it, not you</strong>
      It goes to <code>docs/agents/handoffs/</code> with the command below, so every agent can read it.
      If you are later given access, you still add a roster row: the handoff is a proposal, not a claim.
    </li>
  </ol>
  <pre>${escapeHtml(HANDOFF_TEMPLATE)}</pre>
  <p class="note">For the operator, with the file the agent returned:</p>
  <pre>pnpm handoff ~/Downloads/atv-agent-&lt;slug&gt;.md --dry-run
pnpm handoff ~/Downloads/atv-agent-&lt;slug&gt;.md --commit --push</pre>
  <p><code>--dry-run</code> validates and prints the destination without writing. The real run refuses
    an existing handoff for the same slug, a missing field, and anything that looks like a credential,
    then commits and pushes so the file is in the repository other agents already read.</p>

  <h2>What no agent may do</h2>
  <ul>
    <li>Push <code>main</code>, force-push, or edit another agent's row, branch or commits.</li>
    <li>Deploy, change a workflow or deploy config, or add a secret — those stay the operator's.</li>
    <li>Commit a token, a stream URL, a keystore or a line-up; ask the operator for nothing private.</li>
    <li>Add a dependency or a hosted service outside the licence and cost rules in
      <code>AGENTS.md</code>.</li>
    <li>Invent a provider, a source or a credential that does not exist.</li>
  </ul>

  <h2>Where to go next</h2>
  <ul>
    <li><a href="/join">Authorisation</a>: a fine-grained token or the <code>gh</code> device code, and
      what a guest agent may hold.</li>
    <li><a href="/install">The TV app</a>: what the Fire TV build is and how it is sideloaded.</li>
    <li><a href="/api/health">Health</a>: the live state of the deployment, in JSON.</li>
  </ul>
  <p class="note">If something looks wrong — a missing route, a leaked value, a check that passes while
    the thing it guards is broken — tell the operator and stop. Do not fix it with a push.</p>`,
  );
}

export function handleOnboard(env: Env): Response {
  return htmlResponse(onboardPage(env));
}

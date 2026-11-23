import type { Env } from "./env";
import { escapeHtml, htmlResponse, renderPage } from "./page";

// Public onboarding for a coding agent that has no GitHub app or MCP server: it
// gets a shell, installs `gh`, and the operator authorises it. The page is public
// on purpose — the instructions are not a secret — but nothing here grants
// access: an authorisation is a decision the operator makes per agent.
//
// The two paths are documented in the order they should be chosen. A device-code
// login issues an account-wide OAuth token (`repo`, `read:org`, `gist`,
// `workflow`), which reaches every repository the account administers; a
// fine-grained token can be limited to this one repository. A hosted third-party
// agent should get the narrow one.

export function repoUrl(username: string): string {
  return `https://github.com/${encodeURIComponent(username.trim())}/atv-network-monorepo`;
}

export function joinPage(env: Env): string {
  const owner = env.GITHUB_USERNAME.trim();
  const repo = escapeHtml(repoUrl(owner));
  const clone = escapeHtml(`gh repo clone ${owner}/atv-network-monorepo`);
  return renderPage(
    "Join the ATV Network repository",
    `<h1>Join the ATV Network repository</h1>
  <p class="lede">For a coding agent with no GitHub integration. Install <code>gh</code>, get authorised
    once, clone, and work by pull request. The operator has to approve you; nothing on this page grants
    access by itself.</p>

  <p class="url">${repo}</p>

  <h2>What you get</h2>
  <ul>
    <li><strong>Roles: Author and Reviewer only.</strong> Integrator, Cartographer, Scribe and Sentinel
      stay with the resident agents.</li>
    <li>Push branches and open pull requests. Do not push <code>main</code>.</li>
    <li>No deploys, no workflow edits, no secrets. Stream URLs and provider tokens are not in this
      repository and you should never ask for them.</li>
  </ul>

  <h2>Option A: fine-grained token (recommended)</h2>
  <ol class="steps">
    <li>
      <strong>Create the token</strong>
      At <a href="https://github.com/settings/personal-access-tokens/new">github.com/settings/personal-access-tokens/new</a>,
      choose <em>Only select repositories</em> &#8594; <code>atv-network-monorepo</code>, and set an
      expiry.
    </li>
    <li>
      <strong>Grant only what authoring needs</strong>
      <em>Contents</em> read and write, <em>Pull requests</em> read and write, <em>Metadata</em> read
      (automatic). Set <em>Actions</em>, <em>Workflows</em>, <em>Secrets</em> and <em>Administration</em>
      to no access.
    </li>
    <li>
      <strong>Hand it over out of band</strong>
      The operator puts it in your environment as <code>GH_TOKEN</code>. Never paste a token into a
      chat, an issue, a commit or this page.
    </li>
  </ol>
  <pre>gh auth status
gh auth setup-git
${clone}</pre>

  <h2>Option B: device code, when you cannot receive a token</h2>
  <ol class="steps">
    <li>
      <strong>Start the login in your shell</strong>
      It prints a one-time code, for example <code>ABCD-1234</code>, and waits.
    </li>
    <li>
      <strong>Give the code to the operator</strong>
      They enter it at <a href="https://github.com/login/device">github.com/login/device</a> and approve.
      Nobody needs your password, and the operator never needs your token.
    </li>
    <li>
      <strong>Finish once it returns</strong>
      Then configure git and clone.
    </li>
  </ol>
  <pre>gh auth login --hostname github.com --git-protocol https --web
# copy the one-time code it prints; the operator enters it at
# https://github.com/login/device
gh auth setup-git
${clone}</pre>
  <p class="warn">A device-code token is account-wide: it carries <code>repo</code>,
    <code>read:org</code>, <code>gist</code> and <code>workflow</code>, which reaches every repository the
    account administers, including rulesets and settings. Prefer Option A for a hosted service. If you
    do use it, revoke it when the task ends: <code>gh auth logout --hostname github.com</code>, and
    confirm under Settings &#8594; Applications that the authorisation is gone.</p>

  <h2>After cloning</h2>
  <ol class="steps">
    <li>
      <strong>Read the brief</strong>
      <code>AGENTS.md</code>, then <code>docs/agents/roster.md</code> and
      <code>docs/agents/decisions.md</code>.
    </li>
    <li>
      <strong>Announce yourself</strong>
      One roster row: name, tool or model, roles <code>Author, Reviewer</code>, date, the paths you will
      own, and your task. Commit it before any other edit.
    </li>
    <li>
      <strong>Claim, then work</strong>
      Only your paths, and propose in <code>decisions.md</code> before changing a shared shape.
    </li>
    <li>
      <strong>Open a pull request</strong>
      Quote the checks you ran and the ones you could not; say what you did not verify.
    </li>
  </ol>

  <h2>Public and private</h2>
  <table>
    <tr><th>Public</th><th>Private</th></tr>
    <tr>
      <td>This page, the source, the docs, the TV client build, the APK release asset, <code>/install</code>.</td>
      <td>The line-up (<code>atv-config.json</code>), stream URLs, provider tokens, the signing keystore,
        Worker secrets, KV writes and production.</td>
    </tr>
  </table>
  <p class="note">The repository being public is not an invitation. Access is granted per agent by the
    operator, and can be withdrawn the same way.</p>

  <h2>If something looks wrong</h2>
  <p>The deployment, the line-up and the tokens belong to the operator. Report a suspected leak to them
    and stop; do not try to fix it by pushing.</p>`,
  );
}

export function handleJoin(env: Env): Response {
  return htmlResponse(joinPage(env));
}

import { useEffect, useState } from "react";
import type { HealthPayload } from "@atv/ui-shared";
import { ROOT, enter } from "./folders";
import { fetchHealth, summariseHealth } from "./health";
import { LINK_ICON, LINK_LABEL, checkLinks, type LinkCheck, type LinkProgress } from "./links";
import { readLinkToken, saveLinkToken } from "./linkToken";
import { colour, crumb, folderButton, font, grid, muted, panel, sectionHeading } from "./styles";

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={panel}>
      <div style={{ fontSize: 13, ...muted }}>{label}</div>
      <div style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  // Distinguishes "not asked yet" from "asked and got nothing": both leave
  // `health` null, and only the second is worth calling unreachable.
  const [settled, setSettled] = useState(false);
  const [checks, setChecks] = useState<LinkCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<LinkProgress | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  // The panel's copy of the household token (R6): typed once per browser, never
  // compiled into the bundle. Empty means "not set here", which the check reports
  // as a missing token instead of blaming the channels.
  const [linkToken, setLinkToken] = useState(() => readLinkToken() ?? "");
  const [tokenNote, setTokenNote] = useState<string | null>(null);
  // A folder tree needs a way back. The path is a list so a crumb can slice it;
  // `enter` decides what a click means, including a repeat click on the folder we
  // are already in.
  const [crumbs, setCrumbs] = useState<string[]>([]);
  const [pin] = useState(() => Math.floor(100000 + Math.random() * 900000));
  const folders = ["Idents", "News", "Lineup", "Backups"];

  useEffect(() => {
    let live = true;
    fetchHealth().then((payload) => {
      if (!live) return;
      setHealth(payload);
      setSettled(true);
    });
    return () => {
      live = false;
    };
  }, []);

  async function runCheck() {
    setChecking(true);
    setProgress(null);
    setCheckError(null);
    try {
      setChecks(await checkLinks(fetch, setProgress, linkToken || null));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Link check failed");
      setChecks(null);
    } finally {
      setChecking(false);
    }
  }

  const summary = summariseHealth(health);
  // Before the first answer the summary is a guess, so the panel says it is
  // checking instead of flashing UNREACHABLE and a list of problems it has not
  // confirmed. A zero that has not been measured is shown as a dash.
  const pending = !settled;
  const ready =
    summary.status === "ok" &&
    summary.channels > 0 &&
    summary.links.configured === summary.channels;
  const linkReady = checks ? checks.filter((c) => c.state === "configured").length : 0;

  return (
    <div style={{ padding: 24, fontFamily: font, color: colour.ink }}>
      <h1>ATV Admin CMS - Setup Panel</h1>
      <p role="status" style={{ marginTop: 0 }}>
        Worker{" "}
        <strong style={{ color: pending ? colour.muted : colour.status[summary.status] }}>
          {pending ? "CHECKING…" : summary.status.toUpperCase()}
        </strong>
      </p>
      <div style={grid}>
        <Card label="Channels" value={pending ? "—" : summary.channels} />
        <Card label="Links configured" value={pending ? "—" : summary.links.configured} />
        <Card label="Links unset" value={pending ? "—" : summary.links.missing} />
        <Card label="Links unusable" value={pending ? "—" : summary.links.invalid} />
      </div>
      {!pending && summary.problems.length > 0 && (
        <ul style={{ marginTop: 16, color: colour.warn }}>
          {summary.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <h2 style={sectionHeading}>Stream links</h2>
      <label htmlFor="link-token" style={{ ...muted, display: "block", marginBottom: 4 }}>
        Household token — kept in this browser, needed once the worker enforces it
      </label>
      {/* Wraps, because the input's 280px floor plus the button is wider than a
          420px screen and used to push the button off the panel edge. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <input
          id="link-token"
          type="password"
          value={linkToken}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setLinkToken(event.target.value)}
          style={{ font: "inherit", padding: "6px 8px", minWidth: 280 }}
        />
        <button
          type="button"
          disabled={!linkToken.trim()}
          onClick={() => {
            const saved = saveLinkToken(linkToken);
            setTokenNote(
              saved
                ? "Token saved in this browser."
                : "This browser refused to store it; it applies to the next check only.",
            );
          }}
        >
          Save token
        </button>
      </div>
      {tokenNote && <p style={muted}>{tokenNote}</p>}
      <button onClick={runCheck} disabled={checking}>
        {checking ? "Checking…" : "Check stream links"}
      </button>
      {checking && (
        <p style={muted} role="status">
          {progress
            ? `Asked ${progress.done} of ${progress.total} batch(es)…`
            : "Reading the guide for the channel list…"}
        </p>
      )}
      {checkError && <p style={{ color: colour.danger }}>{checkError}</p>}
      {checks && (
        <>
          <p style={muted}>
            {linkReady}/{checks.length} channel(s) have a usable link. Nothing here shows a URL.
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {checks.map((check) => (
              <li key={check.id}>
                {LINK_ICON[check.state]} <strong>{check.name}</strong>{" "}
                <code style={{ fontSize: 12 }}>{check.id}</code> - {LINK_LABEL[check.state]}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 style={sectionHeading}>Google Drive Folder Tree</h2>
      <div style={panel}>
        <nav style={{ marginBottom: 8, fontSize: 13 }} aria-label="Folder path">
          <button
            type="button"
            style={crumb}
            onClick={() => setCrumbs([])}
            disabled={!crumbs.length}
          >
            /{ROOT}
          </button>
          {crumbs.map((segment, index) => (
            <button
              key={`${index}-${segment}`}
              type="button"
              style={crumb}
              disabled={index === crumbs.length - 1}
              onClick={() => setCrumbs(crumbs.slice(0, index + 1))}
            >
              /{segment}
            </button>
          ))}
        </nav>
        {folders.map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
            {/* A button, not a clickable div: the tree has to be walkable with Tab
                and Enter. The binding hint stays a sibling so no button nests. */}
            <button
              type="button"
              style={folderButton}
              onClick={() => setCrumbs((current) => enter(current, f))}
            >
              {/* Decoration only. An exposed emoji makes a screen reader announce
                  "file folder Idents", so the accessible name is just the name. */}
              <span aria-hidden="true">📁</span> {f}
            </button>
            <button disabled>Bind to gdrive.identsFolder</button>
          </div>
        ))}
      </div>
      {ready && (
        <div
          style={{
            marginTop: 32,
            padding: 24,
            background: "#000",
            color: "#0f0",
            borderRadius: 16,
          }}
        >
          <div style={{ fontSize: 36, letterSpacing: 6 }}>PIN: {pin}</div>
          <div style={{ marginTop: 8 }}>QR: PWA Remote - https://atv.acidwurx.org/remote</div>
        </div>
      )}
    </div>
  );
}

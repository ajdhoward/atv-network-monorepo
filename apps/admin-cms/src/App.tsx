import { useEffect, useState } from "react";
import type { HealthPayload } from "@atv/ui-shared";
import { fetchHealth, summariseHealth } from "./health";
import { LINK_ICON, LINK_LABEL, checkLinks, type LinkCheck } from "./links";
import { colour, font, grid, muted, panel, sectionHeading } from "./styles";

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
  const [checkError, setCheckError] = useState<string | null>(null);
  const [path, setPath] = useState("/ATV Network");
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
    setCheckError(null);
    try {
      setChecks(await checkLinks());
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
      <button onClick={runCheck} disabled={checking}>
        {checking ? "Checking…" : "Check stream links"}
      </button>
      {checking && (
        <p style={muted} role="status">
          Asking the guide and the batched resolve endpoint; this walks every channel once.
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
        <div>
          <code>{path}</code>
        </div>
        {folders.map((f) => (
          <div
            key={f}
            onClick={() => setPath(`${path}/${f}`)}
            style={{ cursor: "pointer", padding: 6 }}
          >
            📁 {f} <button disabled>Bind to gdrive.identsFolder</button>
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

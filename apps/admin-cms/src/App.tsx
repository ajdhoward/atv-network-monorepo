import { useEffect, useState } from "react";
import type { HealthPayload } from "@atv/ui-shared";
import { fetchHealth, summariseHealth } from "./health";

const STATUS_COLOUR = {
  ok: "#0a7d32",
  degraded: "#b45309",
  unreachable: "#b91c1c",
} as const;

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 12 }}>
      <div style={{ fontSize: 13, color: "#555" }}>{label}</div>
      <div style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [checked, setChecked] = useState(false);
  const [path, setPath] = useState("/ATV Network");
  const [pin] = useState(() => Math.floor(100000 + Math.random() * 900000));
  const folders = ["Idents", "News", "Lineup", "Backups"];

  useEffect(() => {
    let live = true;
    fetchHealth().then((payload) => {
      if (!live) return;
      setHealth(payload);
      setChecked(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const summary = summariseHealth(health);
  const ready =
    summary.status === "ok" &&
    summary.channels > 0 &&
    summary.links.configured === summary.channels;

  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui" }}>
      <h1>ATV Admin CMS - Setup Panel</h1>
      <p role="status" style={{ marginTop: 0 }}>
        Worker{" "}
        <strong style={{ color: STATUS_COLOUR[summary.status] }}>
          {summary.status.toUpperCase()}
        </strong>
        {checked ? "" : " (checking...)"}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <Card label="Channels" value={summary.channels} />
        <Card label="Links configured" value={summary.links.configured} />
        <Card label="Links unset" value={summary.links.missing} />
        <Card label="Links unusable" value={summary.links.invalid} />
      </div>
      {summary.problems.length > 0 && (
        <ul style={{ marginTop: 16, color: "#8a4b00" }}>
          {summary.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <h2 style={{ marginTop: 32 }}>Google Drive Folder Tree</h2>
      <div style={{ border: "1px solid #ccc", padding: 12, borderRadius: 8 }}>
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

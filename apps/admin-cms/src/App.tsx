import { useState } from 'react';
export default function App() {
  const [status] = useState({ gdrive: true, tmdb: true, simkl: true, torbox: true });
  const allGreen = Object.values(status).every(Boolean);
  const [path, setPath] = useState('/ATV Network');
  const folders = ['Idents', 'News', 'Lineup', 'Backups'];
  return (
    <div style={{ padding: 24, fontFamily: 'Inter, system-ui' }}>
      <h1>ATV Admin CMS - Setup Panel</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
        {Object.entries(status).map(([k,v]) => (
          <div key={k} style={{ border: '1px solid #ddd', padding: 16, borderRadius: 12, opacity: v?1:0.6 }}>
            <strong>{k.toUpperCase()}</strong> {v?'✅':'🔒'} <button disabled={!v}>{v?'Configured':'Locked'}</button>
          </div>
        ))}
      </div>
      <h2 style={{ marginTop: 32 }}>Google Drive Folder Tree</h2>
      <div style={{ border: '1px solid #ccc', padding: 12, borderRadius: 8 }}>
        <div><code>{path}</code></div>
        {folders.map(f => (
          <div key={f} onClick={()=> setPath(`${path}/${f}`)} style={{ cursor: 'pointer', padding: 6 }}>📁 {f} <button>Bind to gdrive.identsFolder</button></div>
        ))}
      </div>
      {allGreen && (
        <div style={{ marginTop: 32, padding: 24, background: '#000', color: '#0f0', borderRadius: 16 }}>
          <div style={{ fontSize: 36, letterSpacing: 6 }}>PIN: {Math.floor(100000 + Math.random()*900000)}</div>
          <div style={{ marginTop: 8 }}>QR: PWA Remote - https://atv.acidwurx.org/remote</div>
        </div>
      )}
    </div>
  );
}

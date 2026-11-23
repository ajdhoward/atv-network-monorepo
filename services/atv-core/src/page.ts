// Shared shell for the Worker's public pages (/install, /join). Both are static,
// script-free documents, so one template and one policy keep them consistent
// instead of two copies of the same CSS drifting apart.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BASE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0b0f; color: #f5f5f7;
    font: 17px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 660px; margin: 0 auto; padding: 40px 22px 64px; }
  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 10px; }
  h2 { font-size: 21px; margin: 40px 0 12px; }
  p { margin: 0 0 16px; color: #c9c9d4; }
  .lede { color: #9d9dac; }
  a { color: #ffb066; }
  a.button { display: inline-block; margin: 10px 0 8px; padding: 16px 30px; border-radius: 12px;
    background: #f6821f; color: #0b0b0f; font-weight: 700; font-size: 19px; text-decoration: none; }
  .url { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
    color: #8b8b9a; }
  figure.qr { margin: 26px 0; }
  figure.qr img { width: 220px; height: 220px; display: block; border-radius: 10px; background: #fff; }
  figure.qr figcaption { margin-top: 10px; color: #9d9dac; font-size: 15px; }
  ol, ul { padding-left: 22px; }
  li { margin-bottom: 14px; color: #c9c9d4; }
  li strong { color: #f5f5f7; }
  ol.steps > li { margin-bottom: 18px; }
  ol.steps > li strong { display: block; margin-bottom: 4px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px;
    color: #e6e6ef; }
  pre { background: #15151d; border: 1px solid #26262f; border-radius: 10px; padding: 14px 16px;
    overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 18px; font-size: 15px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #26262f; vertical-align: top; }
  th { color: #f5f5f7; font-weight: 600; }
  td { color: #c9c9d4; }
  .note { border-left: 3px solid #f6821f; padding: 2px 0 2px 14px; color: #9d9dac; font-size: 15px; }
  .warn { border-left: 3px solid #ff5d5d; padding: 2px 0 2px 14px; color: #eec9c9; font-size: 15px; }
`;

// Neither page runs a script or loads anything off-origin, so the policy says
// exactly that rather than leaving the header absent.
export const PAGE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

export function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Both pages are static; the edge can hold them for minutes.
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": PAGE_CSP,
    },
  });
}

// The Drive proxy — P1. `/api/resolve` mints a ticket, `/api/stream/<id>` spends
// it and streams the bytes.
//
// Drive shares a file as a page (`…/file/d/<id>/view`), not as media, so a
// `<video src>` pointed at the shared link plays nothing. This module holds the
// two pure parts of the fix: finding the file id in whatever URL the operator
// stored, and building the media request the Worker makes on the TV's behalf.
//
// The route itself lives in `index.ts` (verifying the ticket, calling this and
// answering) because that is where the router, the error shape and the counters
// already are — the same reason `/api/idents/random` is handled there.
//
// Nothing here reads a secret or holds a link: a stream URL must never be logged,
// returned to the TV or kept, and the only thing this file produces is an
// upstream URL for the Worker's own fetch.

import { signStreamUrl } from "./stream-sign";

// Drive id: 10 or more of `[A-Za-z0-9_-]`, which every form below shares.
const FILE_ID = /^[A-Za-z0-9_-]{10,}$/;

const DRIVE_HOSTS = new Set([
  "drive.google.com",
  "drive.usercontent.google.com",
  "docs.google.com",
]);

// The operator stores a share URL in `gdrive_map` / `ATV_GDRIVE_MAP`, and all
// three shapes Drive hands out carry the id somewhere different:
//
//   https://drive.google.com/file/d/<id>/view?usp=sharing
//   https://drive.google.com/open?id=<id>
//   https://drive.google.com/uc?id=<id>&export=download
//
// `null` means "not a Drive link", which the proxy refuses rather than guessing:
// a CDN `.m3u8` proxied as a file would hand the player a playlist it cannot
// follow.
export function driveFileId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!DRIVE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const fromPath = /\/d\/([A-Za-z0-9_-]+)/.exec(parsed.pathname);
  if (fromPath && FILE_ID.test(fromPath[1])) return fromPath[1];

  const fromQuery = parsed.searchParams.get("id");
  return fromQuery && FILE_ID.test(fromQuery) ? fromQuery : null;
}

// Where the bytes come from. `usercontent` is the origin Drive's own download
// button streams from, and the one that answers `Range`; the API endpoint
// (`www.googleapis.com/drive/v3/files/<id>?alt=media`) needs a service-account
// token, which is P2 and not set. A file that is not shared link-wide therefore
// answers Drive's own 403, which the route reports as `upstream_error` rather
// than letting it read as a broken ticket. When P2 lands, this is the one line
// that changes, plus the header it needs.
export function driveMediaUrl(fileId: string): string {
  const query = new URLSearchParams({ id: fileId, export: "download", confirm: "t" });
  return `https://drive.usercontent.google.com/download?${query}`;
}

// The link `/api/resolve` should hand out for a channel. A Drive URL becomes a
// same-origin ticket only when the signing key exists: without it this route
// cannot serve the file, so the stored link is returned unchanged — exactly what
// the Worker answered before P1 — rather than turning every Drive channel into a
// 503 before the operator has set the secret.
export async function proxyTicket(
  id: string,
  link: string,
  env: { ATV_STREAM_SIGNING_KEY?: string },
) {
  if (!driveFileId(link)) return link;
  const secret = env.ATV_STREAM_SIGNING_KEY?.trim();
  if (!secret) return link;
  return signStreamUrl(id, secret);
}

// What a media response may carry through. Everything else the origin sends
// (cookies, its own cache headers, its request id) belongs to the origin.
//
// `content-encoding` and `content-disposition` describe the bytes rather than the
// request, so dropping them makes the response lie: a body the origin encoded
// arrives undeclared, and a player is handed an attachment with no name. Both
// are forwarded as the origin wrote them, because neither is this Worker's to
// reinterpret.
const PASSTHROUGH = [
  "content-type",
  "content-length",
  "content-range",
  "content-encoding",
  "content-disposition",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

// The headers on every answer from `/api/stream`. `no-store` throughout: the URL
// carries a ticket, and a cached copy would outlive it. Range is a request the
// player repeats, so `Content-Range` and `Accept-Ranges` have to reach it — the
// TV's `<video crossOrigin="anonymous">` also means this must be a CORS response,
// and a header the player cannot read is a header that does not exist.
export function mediaHeaders(upstream: Response): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers":
      "Content-Range, Accept-Ranges, Content-Length, ETag, X-Request-Id",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of PASSTHROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // A partial answer proves the origin ranges; say so even if it forgot the
  // header, because a player that cannot see `Accept-Ranges` will not seek.
  if (upstream.status === 206 && !headers.has("accept-ranges")) {
    headers.set("Accept-Ranges", "bytes");
  }
  return headers;
}

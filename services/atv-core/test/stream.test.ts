import { describe, expect, it } from "vitest";
import { driveFileId, driveMediaUrl, mediaHeaders, proxyTicket } from "../src/stream";

const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWx";

describe("driveFileId", () => {
  // The three shapes Drive's share button produces. The operator pastes one of
  // them into gdrive_map, and only the id matters to the media endpoint.
  it("finds the id in a file, open or uc link", () => {
    expect(driveFileId(`https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`)).toBe(
      FILE_ID,
    );
    expect(driveFileId(`https://drive.google.com/open?id=${FILE_ID}`)).toBe(FILE_ID);
    expect(driveFileId(`https://drive.google.com/uc?id=${FILE_ID}&export=download`)).toBe(FILE_ID);
    expect(driveFileId(`https://docs.google.com/file/d/${FILE_ID}/edit`)).toBe(FILE_ID);
  });

  // Null, not a guess: a CDN playlist proxied as a file is a player with no
  // segments, which looks like a broken channel rather than a refused one.
  it("refuses anything that is not a Drive link", () => {
    expect(driveFileId("https://cdn.example/news.m3u8")).toBeNull();
    expect(driveFileId("https://example.com/file/d/whatever/")).toBeNull();
    expect(driveFileId("not a url")).toBeNull();
    expect(driveFileId("")).toBeNull();
  });

  it("refuses a Drive link whose id is too short to be one", () => {
    expect(driveFileId("https://drive.google.com/file/d/short/view")).toBeNull();
    expect(driveFileId("https://drive.google.com/open?id=")).toBeNull();
  });
});

describe("driveMediaUrl", () => {
  it("asks the origin that streams and honours Range, for the id only", () => {
    const url = new URL(driveMediaUrl(FILE_ID));

    expect(url.origin).toBe("https://drive.usercontent.google.com");
    expect(url.pathname).toBe("/download");
    expect(url.searchParams.get("id")).toBe(FILE_ID);
    expect(url.searchParams.get("export")).toBe("download");
  });
});

describe("proxyTicket", () => {
  const DRIVE = `https://drive.google.com/file/d/${FILE_ID}/view`;

  it("signs a Drive link and leaves every other link alone", async () => {
    expect(await proxyTicket("news", DRIVE, { ATV_STREAM_SIGNING_KEY: "k" })).toMatch(
      /^\/api\/stream\/news\?exp=\d+&sig=[0-9a-f]{64}$/,
    );
    expect(
      await proxyTicket("news", "https://cdn.example/news.m3u8", { ATV_STREAM_SIGNING_KEY: "k" }),
    ).toBe("https://cdn.example/news.m3u8");
  });

  // Before the operator sets the key, resolve keeps answering what it answered
  // before P1 rather than turning every Drive channel into a 503.
  it("falls back to the stored link when there is no key", async () => {
    expect(await proxyTicket("news", DRIVE, {})).toBe(DRIVE);
    expect(await proxyTicket("news", DRIVE, { ATV_STREAM_SIGNING_KEY: "  " })).toBe(DRIVE);
  });
});

describe("mediaHeaders", () => {
  it("keeps the range headers a player needs and drops the origin's cache policy", () => {
    const headers = mediaHeaders(
      new Response(null, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 10-19/100",
          "content-length": "10",
          "cache-control": "public, max-age=7200",
        },
      }),
    );

    expect(headers.get("content-type")).toBe("video/mp4");
    expect(headers.get("content-range")).toBe("bytes 10-19/100");
    expect(headers.get("content-length")).toBe("10");
    expect(headers.get("accept-ranges")).toBe("bytes");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("access-control-allow-origin")).toBe("*");
  });

  it("does not claim byte ranges on a whole-file answer", () => {
    const headers = mediaHeaders(new Response(null, { status: 200 }));

    expect(headers.get("accept-ranges")).toBeNull();
    expect(headers.get("content-range")).toBeNull();
  });
});

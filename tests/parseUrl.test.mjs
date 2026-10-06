/**
 * URL parser tests — at least 5 real-world formats per provider
 * (short links, mobile links, tracking parameters).
 *
 * Run:  npm run test:parser   (Node 22+ type-strips the TS import)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseProviderUrl, embedUrlFor, isKnownProviderHost } from "../lib/video/parseUrl.ts";

const cases = [
  // Facebook
  ["https://www.facebook.com/watch/?v=1234567890123456", "facebook"],
  ["https://www.facebook.com/NationalGeographic/videos/9876543210987654", "facebook"],
  ["https://fb.watch/aBcDeFgHiJk/", "facebook"],
  ["https://m.facebook.com/SomePage/videos/1234567890123456/?refsrc=whatever", "facebook"],
  ["https://www.facebook.com/reel/1234567890123456", "facebook"],
  // Vimeo
  ["https://vimeo.com/123456789", "vimeo"],
  ["https://vimeo.com/channels/staffpicks/123456789", "vimeo"],
  ["https://player.vimeo.com/video/123456789", "vimeo"],
  ["https://vimeo.com/123456789?h=abc123&utm_source=x", "vimeo"],
  ["https://vimeo.com/ondemand/pages/123456789?autoplay=1", "vimeo"],
  // Dailymotion
  ["https://www.dailymotion.com/video/x8abcdef", "dailymotion"],
  ["https://dai.ly/x8abcdef", "dailymotion"],
  ["https://www.dailymotion.com/embed/video/x8abcdef", "dailymotion"],
  ["https://www.dailymotion.com/video/x8ABCDEF?playlist=x123", "dailymotion"],
  ["https://geo.dailymotion.com/player/xbh8c?video=x8abcdef", "dailymotion"],
  // Twitch (VODs only)
  ["https://www.twitch.tv/videos/1234567890", "twitch"],
  ["https://twitch.tv/videos/1234567890?t=1h2m3s", "twitch"],
  ["https://www.twitch.tv/videos/9876543210", "twitch"],
  ["https://m.twitch.tv/videos/1234567890", "twitch"],
  ["https://twitch.tv/videos/555666777?ref=share", "twitch"],
  // TikTok
  ["https://www.tiktok.com/@peermates/video/7234567890123456789", "tiktok"],
  ["https://www.tiktok.com/@user/video/7000000000000000001?lang=en&q=x", "tiktok"],
  ["https://m.tiktok.com/v/7234567890123456789.html", "tiktok"],
  ["https://vm.tiktok.com/ZM123abc/", "tiktok"],
  ["https://vt.tiktok.com/ZS456def/", "tiktok"],
  // Instagram
  ["https://www.instagram.com/reel/C1234567890abcdef/", "instagram"],
  ["https://www.instagram.com/p/C1234567890abcdef/?utm_source=ig_web", "instagram"],
  ["https://www.instagram.com/tv/C1234567890abcdef/", "instagram"],
  ["https://m.instagram.com/reel/C1234567890abcdef/", "instagram"],
  ["https://www.instagram.com/reel/C1234567890abcdef/?igsh=abc123", "instagram"],
  // Google Drive
  ["https://drive.google.com/file/d/1ABCdefGhI1234567890/view?usp=sharing", "drive"],
  ["https://drive.google.com/file/d/1ABCdefGhI1234567890/view", "drive"],
  ["https://drive.google.com/open?id=1ABCdefGhI1234567890", "drive"],
  ["https://drive.google.com/file/d/1ABCdefGhI1234567890/preview", "drive"],
  ["https://drive.google.com/uc?id=1ABCdefGhI1234567890&export=download", "drive"],
  // Streamable
  ["https://streamable.com/abcdef", "streamable"],
  ["https://streamable.com/abc123XYZ", "streamable"],
  ["https://streamable.com/e/abcdef", "streamable"],
  ["https://streamable.com/abcdef?t=12", "streamable"],
  ["https://streamable.com/o/abcdef", "streamable"],
  // Loom
  ["https://www.loom.com/share/1234567890abcdef1234567890abcdef", "loom"],
  ["https://www.loom.com/share/1234567890abcdef1234567890abcdef?sid=x", "loom"],
  ["https://loom.com/share/abcdef1234567890abcdef1234567890", "loom"],
  ["https://www.loom.com/share/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "loom"],
  ["https://www.loom.com/share/00000000000000000000000000000000", "loom"],
  // Internet Archive
  ["https://archive.org/details/big_buck_bunny", "archive"],
  ["https://archive.org/details/sintel_movie?view=theater", "archive"],
  ["https://archive.org/embed/big_buck_bunny", "archive"],
  ["https://archive.org/download/big_buck_bunny/bbb.mp4", "archive"],
  ["https://ia800000.us.archive.org/1/items/x/y.mp4", "archive"],
  // Dropbox
  ["https://www.dropbox.com/s/abc123def456/movie.mp4?dl=0", "dropbox"],
  ["https://www.dropbox.com/s/abc123def456/movie.mp4?dl=0&raw=1", "dropbox"],
  ["https://dl.dropboxusercontent.com/s/abc123def456/movie.mp4", "dropbox"],
  ["https://www.dropbox.com/scl/fi/xyz123/movie.mp4?rlkey=abc&dl=0", "dropbox"],
  ["https://www.dropbox.com/s/abc123def456/movie.mp4", "dropbox"],
];

describe("parseProviderUrl", () => {
  for (const [url, want] of cases) {
    it(`${want}: ${url}`, () => {
      const got = parseProviderUrl(url);
      assert.ok(got, `expected a parse result for ${url}`);
      assert.equal(got.provider, want);
      assert.ok(got.id.length > 0, "expected a non-empty id");
    });
  }

  it("rejects live Twitch channels and clips (VODs only)", () => {
    assert.equal(parseProviderUrl("https://www.twitch.tv/somechannel"), null);
    assert.equal(parseProviderUrl("https://www.twitch.tv/somechannel/clip/FunnyClip-x"), null);
  });

  it("rejects non-URLs and unknown hosts", () => {
    assert.equal(parseProviderUrl("not a url"), null);
    assert.equal(parseProviderUrl("https://example.com/video.mp4"), null);
    assert.equal(parseProviderUrl(""), null);
  });

  it("flags known hosts even when the form is unsupported", () => {
    assert.equal(isKnownProviderHost("https://www.twitch.tv/somechannel"), "twitch");
    assert.equal(isKnownProviderHost("https://example.com/x"), null);
  });

  it("dropbox links convert to direct dl=1 links", () => {
    const got = parseProviderUrl("https://www.dropbox.com/s/abc/movie.mp4?dl=0");
    assert.ok(got && got.provider === "dropbox" && got.control === "full");
    assert.ok(got.id.includes("dl=1"), `expected dl=1 in ${got.id}`);
  });

  it("archive download links stay full-control, details go guided", () => {
    const dl = parseProviderUrl("https://archive.org/download/x/y.mp4");
    const details = parseProviderUrl("https://archive.org/details/x");
    assert.equal(dl?.control, "full");
    assert.equal(details?.control, "guided");
  });

  it("builds embed URLs for guided providers", () => {
    const v = parseProviderUrl("https://vimeo.com/123456789");
    assert.ok(v && embedUrlFor(v)?.includes("player.vimeo.com/video/123456789"));
    const d = parseProviderUrl("https://drive.google.com/file/d/ABC1234567890/view");
    assert.ok(d && embedUrlFor(d)?.endsWith("/preview"));
    const t = parseProviderUrl("https://www.twitch.tv/videos/1");
    assert.ok(t && embedUrlFor(t, "example.com")?.includes("parent=example.com"));
    const lo = parseProviderUrl("https://www.loom.com/share/1234567890abcdef1234567890abcdef");
    assert.ok(lo && embedUrlFor(lo)?.includes("/embed/"));
    const ig = parseProviderUrl("https://www.instagram.com/reel/ABC123_-x/");
    assert.ok(ig && embedUrlFor(ig)?.endsWith("/embed"));
  });
});

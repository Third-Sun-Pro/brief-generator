import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function mockFetchResponse(html, options = {}) {
  const {
    ok = true,
    status = 200,
    contentType = "text/html; charset=utf-8",
  } = options;

  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: (name) => (name === "content-type" ? contentType : null) },
    text: async () => html,
  });
}

// Load scrape.js fresh for each describe block
const { scrapeNavigation } = require("../scrape");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scrapeNavigation", () => {
  it("extracts links from nav, header, and footer", async () => {
    const html = `
      <html>
        <header><a href="/">Home</a><a href="/about">About</a></header>
        <nav><a href="/services">Services</a><a href="/portfolio">Portfolio</a></nav>
        <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
      </html>
    `;
    vi.stubGlobal("fetch", mockFetchResponse(html));

    const result = await scrapeNavigation("https://example.com");

    expect(result).toContain("Header Links:");
    expect(result).toContain("- Home (/)");
    expect(result).toContain("- About (/about)");
    expect(result).toContain("Main Navigation:");
    expect(result).toContain("- Services (/services)");
    expect(result).toContain("Footer Links:");
    expect(result).toContain("- Privacy (/privacy)");
  });

  it("handles page with only nav (no header/footer links)", async () => {
    const html = `<html><nav><a href="/about">About</a></nav></html>`;
    vi.stubGlobal("fetch", mockFetchResponse(html));

    const result = await scrapeNavigation("https://example.com");

    expect(result).toContain("Main Navigation:");
    expect(result).not.toContain("Header Links:");
    expect(result).not.toContain("Footer Links:");
  });

  it("filters out # anchors and javascript: hrefs", async () => {
    const html = `
      <html><nav>
        <a href="/real">Real Link</a>
        <a href="#">Anchor</a>
        <a href="javascript:void(0)">JS Link</a>
      </nav></html>
    `;
    vi.stubGlobal("fetch", mockFetchResponse(html));

    const result = await scrapeNavigation("https://example.com");

    expect(result).toContain("- Real Link (/real)");
    expect(result).not.toContain("Anchor");
    expect(result).not.toContain("JS Link");
  });

  it("deduplicates links by href within a region", async () => {
    const html = `
      <html><nav>
        <a href="/about">About</a>
        <a href="/about">About Us</a>
      </nav></html>
    `;
    vi.stubGlobal("fetch", mockFetchResponse(html));

    const result = await scrapeNavigation("https://example.com");

    const aboutMatches = result.match(/\/about\)/g);
    expect(aboutMatches).toHaveLength(1);
  });

  it("returns fallback when no nav elements found", async () => {
    const html = `<html><body><div>Just content</div></body></html>`;
    vi.stubGlobal("fetch", mockFetchResponse(html));

    const result = await scrapeNavigation("https://example.com");

    expect(result).toContain("No navigation links could be extracted");
  });

  it("throws on non-HTML response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse("{}", { contentType: "application/json" })
    );

    await expect(scrapeNavigation("https://example.com")).rejects.toThrow(
      "did not return an HTML page"
    );
  });

  it("throws on HTTP error status", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse("Not Found", { ok: false, status: 404 })
    );

    await expect(scrapeNavigation("https://example.com")).rejects.toThrow(
      "HTTP 404"
    );
  });

  it("throws on timeout", async () => {
    const err = new Error("Timeout");
    err.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));

    await expect(scrapeNavigation("https://example.com")).rejects.toThrow(
      "timed out"
    );
  });

  it("prepends https:// when protocol is missing", async () => {
    const html = `<html><nav><a href="/about">About</a></nav></html>`;
    const mockFn = mockFetchResponse(html);
    vi.stubGlobal("fetch", mockFn);

    await scrapeNavigation("example.com");

    expect(mockFn).toHaveBeenCalledWith(
      "https://example.com",
      expect.any(Object)
    );
  });

  it("throws on invalid URL", async () => {
    await expect(scrapeNavigation("://bad")).rejects.toThrow("Invalid URL");
  });

  it("filters out links with empty text", async () => {
    const html = `
      <html><nav>
        <a href="/about">About</a>
        <a href="/empty">  </a>
        <a href="/icon"><img src="icon.png"></a>
      </nav></html>
    `;
    vi.stubGlobal("fetch", mockFetchResponse(html));

    const result = await scrapeNavigation("https://example.com");

    expect(result).toContain("- About (/about)");
    expect(result).not.toContain("/empty");
  });
});

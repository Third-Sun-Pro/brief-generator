const cheerio = require("cheerio");

/**
 * Fetches a URL and extracts navigation links from <nav>, <header>, and <footer>.
 * @param {string} url - The URL to scrape
 * @returns {Promise<string>} Formatted text describing the site's navigation structure
 */
async function scrapeNavigation(url) {
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  try {
    new URL(normalizedUrl);
  } catch {
    throw new Error("Site scraping failed: Invalid URL.");
  }

  let response;
  try {
    response = await fetch(normalizedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ThirdSunBriefBot/1.0)",
      },
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error("Site scraping failed: Request timed out after 10 seconds.");
    }
    throw new Error(`Site scraping failed: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`Site scraping failed: HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error("Site scraping failed: URL did not return an HTML page.");
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  function extractLinks(selector, label) {
    const seen = new Set();
    const links = [];

    $(selector).find("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().replace(/\s+/g, " ");

      if (!text) return;
      if (href === "#" || href.startsWith("javascript:")) return;
      if (seen.has(href)) return;

      seen.add(href);
      links.push({ text, href });
    });

    return links.length ? { label, links } : null;
  }

  const sections = [
    extractLinks("header", "Header Links"),
    extractLinks("nav", "Main Navigation"),
    extractLinks("footer", "Footer Links"),
  ].filter(Boolean);

  const header = `CURRENT WEBSITE NAVIGATION (scraped from ${normalizedUrl})`;

  if (sections.length === 0) {
    return `${header}\n\nNo navigation links could be extracted from this page.`;
  }

  const body = sections
    .map((s) => {
      const items = s.links.map((l) => `- ${l.text} (${l.href})`).join("\n");
      return `${s.label}:\n${items}`;
    })
    .join("\n\n");

  return `${header}\n\n${body}`;
}

module.exports = { scrapeNavigation };

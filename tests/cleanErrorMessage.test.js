import { describe, it, expect, beforeAll } from "vitest";

let cleanErrorMessage;

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.APP_PASSWORD = "test-pass";

  // Stub dependencies so server.js can load
  const generatePath = require.resolve("../generate");
  require.cache[generatePath] = {
    id: generatePath, filename: generatePath, loaded: true,
    exports: { generateBrief: () => {}, generateBriefStream: () => {}, reviseBriefStream: () => {} },
  };
  const scrapePath = require.resolve("../scrape");
  require.cache[scrapePath] = {
    id: scrapePath, filename: scrapePath, loaded: true,
    exports: { scrapeNavigation: () => {} },
  };
  const archivePath = require.resolve("../archive");
  require.cache[archivePath] = {
    id: archivePath, filename: archivePath, loaded: true,
    exports: { addEntry: () => {}, listEntries: () => [], getEntry: () => null },
  };

  cleanErrorMessage = require("../server").cleanErrorMessage;
});

describe("cleanErrorMessage", () => {
  it("returns overloaded message for overloaded_error", () => {
    const err = { error: { type: "overloaded_error" } };
    expect(cleanErrorMessage(err)).toBe(
      "The AI service is currently overloaded. Please wait a moment and try again."
    );
  });

  it("returns rate limit message for rate_limit_error", () => {
    const err = { error: { type: "rate_limit_error" } };
    expect(cleanErrorMessage(err)).toBe(
      "Rate limit reached. Please wait a moment and try again."
    );
  });

  it("returns auth message for authentication_error", () => {
    const err = { error: { type: "authentication_error" } };
    expect(cleanErrorMessage(err)).toBe(
      "API key is missing or invalid. Contact your administrator."
    );
  });

  it("returns too-large message for invalid_request_error with token mention", () => {
    const err = { error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } };
    expect(cleanErrorMessage(err)).toBe(
      "Request was too large. Try with fewer or smaller files."
    );
  });

  it("returns generic invalid request message for other invalid_request_error", () => {
    const err = { error: { type: "invalid_request_error", message: "missing field" } };
    expect(cleanErrorMessage(err)).toBe(
      "Request could not be processed. Check your inputs and try again."
    );
  });

  it("returns network message for ECONNREFUSED", () => {
    const err = new Error("connect ECONNREFUSED");
    err.code = "ECONNREFUSED";
    expect(cleanErrorMessage(err)).toBe(
      "Could not reach the AI service. Check your internet connection and try again."
    );
  });

  it("returns network message for ENOTFOUND", () => {
    const err = new Error("getaddrinfo ENOTFOUND");
    err.code = "ENOTFOUND";
    expect(cleanErrorMessage(err)).toBe(
      "Could not reach the AI service. Check your internet connection and try again."
    );
  });

  it("returns network message for ETIMEDOUT via err.cause.code", () => {
    const err = new Error("request timed out");
    err.cause = { code: "ETIMEDOUT" };
    expect(cleanErrorMessage(err)).toBe(
      "Could not reach the AI service. Check your internet connection and try again."
    );
  });

  it("falls back to status 429", () => {
    const err = { status: 429 };
    expect(cleanErrorMessage(err)).toBe(
      "Rate limit reached. Please wait a moment and try again."
    );
  });

  it("falls back to status 500", () => {
    const err = { status: 500 };
    expect(cleanErrorMessage(err)).toBe(
      "The AI service is temporarily unavailable. Please try again."
    );
  });

  it("falls back to err.message", () => {
    const err = new Error("Custom error");
    expect(cleanErrorMessage(err)).toBe("Custom error");
  });

  it("returns default message when no info available", () => {
    expect(cleanErrorMessage({})).toBe("Something went wrong. Please try again.");
  });
});

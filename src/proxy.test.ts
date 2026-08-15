import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const updateSessionMock = vi.fn(async () => new Response(null, { status: 200 }));
vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: () => updateSessionMock(),
}));

import { proxy } from "./proxy";

function makeRequest(url: string, method: string, origin?: string): NextRequest {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new NextRequest(new Request(url, { method, headers }));
}

describe("proxy (cross-origin guard)", () => {
  it("blocks a mutating request whose Origin doesn't match the app's own", async () => {
    const req = makeRequest("https://app.example.com/api/messages", "POST", "https://evil.example.com");
    const res = await proxy(req);
    expect(res.status).toBe(403);
    expect(updateSessionMock).not.toHaveBeenCalled();
  });

  it("allows a mutating request with a matching same-origin Origin header", async () => {
    const req = makeRequest("https://app.example.com/api/messages", "POST", "https://app.example.com");
    await proxy(req);
    expect(updateSessionMock).toHaveBeenCalled();
  });

  it("allows a mutating request with no Origin header at all (non-browser callers)", async () => {
    const req = makeRequest("https://app.example.com/api/messages", "POST");
    await proxy(req);
    expect(updateSessionMock).toHaveBeenCalled();
  });

  it("never blocks a GET request regardless of Origin", async () => {
    const req = makeRequest("https://app.example.com/api/messages", "GET", "https://evil.example.com");
    await proxy(req);
    expect(updateSessionMock).toHaveBeenCalled();
  });

  it("exempts /api/webhooks/* even with a mismatched Origin", async () => {
    const req = makeRequest("https://app.example.com/api/webhooks/stripe", "POST", "https://stripe.example.com");
    await proxy(req);
    expect(updateSessionMock).toHaveBeenCalled();
  });

  it("does not block a mutating request to a non-api page route with a mismatched Origin", async () => {
    // Only /api/* mutations are what this guard is meant for -- page routes
    // aren't state-changing API endpoints and shouldn't be caught here.
    const req = makeRequest("https://app.example.com/log", "POST", "https://evil.example.com");
    await proxy(req);
    expect(updateSessionMock).toHaveBeenCalled();
  });
});

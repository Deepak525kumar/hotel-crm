import { apiFetch, ApiError, employeesApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

/**
 * apiFetch is the single choke point every API call goes through: token
 * revocation, refresh-and-retry, and rate-limit handling all live here once
 * rather than per endpoint. A bug here is silent everywhere at once, and none
 * of it was covered before this suite.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// apiFetch reads the body via .text() (parseEnvelope), not .json().
function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    clone() {
      return jsonRes(status, body);
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  useAuthStore.getState().clear();
});

describe("apiFetch", () => {
  it("returns data unwrapped from a success envelope", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { status: "success", data: { id: 1 } }));
    await expect(apiFetch("/x")).resolves.toEqual({ id: 1 });
  });

  it("throws ApiError with the envelope's code/message on a 4xx", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRes(409, { status: "error", error: { code: "CONFLICT", message: "nope" } }),
    );
    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 409, code: "CONFLICT", message: "nope" });
  });

  // TOKEN_REVOKED must clear the session immediately and never attempt a
  // refresh -- refreshing would either loop or hand back a token for a state
  // that no longer holds (ADR-031 C-7).
  it("clears the session and does not refresh on TOKEN_REVOKED", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonRes(401, { status: "error", error: { code: "TOKEN_REVOKED", message: "revoked" } }),
    );
    const clearSpy = jest.spyOn(useAuthStore.getState(), "clear");

    await expect(apiFetch("/x")).rejects.toMatchObject({ code: "TOKEN_REVOKED" });
    expect(clearSpy).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1); // no refresh call fired
  });

  // Ordinary expiry: refresh once, retry once, succeed.
  it("refreshes and retries a plain 401 once, then returns the retried result", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes(401, { status: "error", error: { code: "UNAUTHORIZED", message: "x" } }))
      .mockResolvedValueOnce(jsonRes(200, {})) // refresh call
      .mockResolvedValueOnce(jsonRes(200, { status: "success", data: "ok" }));

    await expect(apiFetch("/x")).resolves.toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // A failed refresh must not retry forever -- the original 401 surfaces.
  it("does not retry a second time when the refresh itself fails", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonRes(401, { status: "error", error: { code: "UNAUTHORIZED", message: "x" } }))
      .mockResolvedValueOnce(jsonRes(401, {})); // refresh fails

    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 401 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // A 429 is produced by the edge (Nginx/Cloudflare), not the app -- its body
  // is not guaranteed to be the app's JSON envelope, so this must be checked
  // BEFORE attempting an envelope parse.
  it("throws RATE_LIMITED on a 429 without parsing the body as an envelope", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "",
      json: () => Promise.reject(new Error("not json")),
      headers: new Headers({ "Retry-After": "30" }),
    } as unknown as Response);

    const err = await apiFetch("/x").catch((e) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("RATE_LIMITED");
  });
});

// 2026-08-26 (reported live: "The edit skills function is still not working
// after clicking submit it says malformed body"). employeesApi.update()
// pre-stringified its own body with JSON.stringify(data), and apiFetch
// unconditionally JSON.stringify()s whatever `body` it's handed — so the
// request went out DOUBLE-encoded (a JSON string containing an escaped JSON
// string, e.g. '"{\\"skills\\":[\\"CLEANER\\"]}"'). Express's body-parser
// happily parses that as valid JSON... whose value is a plain string, not
// an object, which is exactly what the backend's zod object schema then
// rejected. Every other apiFetch caller in this codebase passes the raw
// object and lets apiFetch do the one-and-only stringify; this pins that
// employeesApi.update does the same, so the regression can't come back.
describe("employeesApi.update — body must be single-encoded JSON", () => {
  it("sends the raw object as the fetch body, not a pre-stringified string", async () => {
    mockFetch.mockResolvedValueOnce(jsonRes(200, { status: "success", data: {} }));

    await employeesApi.update("emp-1", { skills: ["CLEANER"] });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // The body itself must be a JSON string of the OBJECT -- parsing it once
    // must yield the object back, not another JSON string.
    const parsedOnce = JSON.parse(init.body as string);
    expect(parsedOnce).toEqual({ skills: ["CLEANER"] });
    expect(typeof parsedOnce).toBe("object");
  });
});

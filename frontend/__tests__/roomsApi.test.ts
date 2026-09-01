import { qualityApi, roomsApi } from "@/lib/api";

/**
 * Wire-level contract for the room log (owner decision, 2026-09-01).
 *
 * Every assertion here is about a field that is invisible to `tsc` once it
 * reaches `FormData` or a query string -- which is exactly how the web's
 * inspection write came to drop `room_number` while the type said it was
 * required, and every submit was refused with "A room number is required".
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    clone() {
      return jsonRes(body, status);
    },
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function lastCall() {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return { url, init };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(jsonRes({ status: "success", data: {} }));
});

describe("roomsApi", () => {
  // "Today" is Europe/Berlin server-side (rooms/service.ts toDayDate). A
  // client-supplied day would disagree with it between midnight and 02:00
  // Berlin time, showing a worker an empty log and a checker yesterday's
  // rooms -- so the default read must send no `day` at all.
  it("sends no day parameter when none was asked for", async () => {
    await roomsApi.mine();
    expect(lastCall().url).toBe("/api/v1/rooms/mine");

    await roomsApi.forCheck();
    expect(lastCall().url).toBe("/api/v1/rooms/for-check");

    await roomsApi.forHotels();
    expect(lastCall().url).toBe("/api/v1/rooms/for-hotels");
  });

  it("passes an explicit day and hotel through as query parameters", async () => {
    await roomsApi.mine("2026-09-01");
    expect(lastCall().url).toBe("/api/v1/rooms/mine?day=2026-09-01");

    await roomsApi.forCheck({ hotel_id: "h1" });
    expect(lastCall().url).toBe("/api/v1/rooms/for-check?hotel_id=h1");

    await roomsApi.suggestions("h1");
    expect(lastCall().url).toBe("/api/v1/rooms/suggestions?hotel_id=h1");
  });

  it("logs a room against the shift in the path and sends only the room number", async () => {
    await roomsApi.log("a1", "412");
    const { url, init } = lastCall();
    expect(url).toBe("/api/v1/rooms/assignments/a1/rooms");
    expect(init.method).toBe("POST");
    // No worker_id, hotel_id or day: the server derives all three from the
    // assignment, and a client that could name them could log somebody
    // else's room.
    expect(JSON.parse(init.body as string)).toEqual({ room_number: "412" });
  });
});

describe("qualityApi.recordInspection", () => {
  const base = {
    assignment_id: "a1",
    worker_id: "w1",
    room_number: "412",
    score: 90,
    outcome: "complete" as const,
  };

  // The room-first flow's whole point: `room_log_id` is what links the check
  // to the room the WORKER logged. It is only accepted by /quality/inspections
  // -- /quality/verifications silently discards it (its schema is not
  // `.strict()`), which would leave the room reading "awaiting check" forever
  // with an inspection sitting against it.
  it("posts to /quality/inspections and carries room_log_id when a room was picked", async () => {
    mockFetch.mockResolvedValue(
      jsonRes({ status: "success", data: { verification: { id: "v1" }, rework_assignment: null } }),
    );
    await qualityApi.recordInspection({ ...base, room_log_id: "rl1" });

    const { url, init } = lastCall();
    expect(url).toBe("/api/v1/quality/inspections");
    const body = init.body as FormData;
    expect(body.get("room_log_id")).toBe("rl1");
    expect(body.get("assignment_id")).toBe("a1");
    expect(body.get("worker_id")).toBe("w1");
    expect(body.get("room_number")).toBe("412");
    expect(body.get("outcome")).toBe("complete");
  });

  // The fallback exists on purpose: a worker can forget to log a room, and a
  // skipped room must stay inspectable. Sending an empty `room_log_id` would
  // fail the server's `min(1)` rather than taking that path.
  it("omits room_log_id entirely on the typed-room fallback", async () => {
    await qualityApi.recordInspection(base);
    const body = lastCall().init.body as FormData;
    expect(body.has("room_log_id")).toBe(false);
  });

  it("json-encodes the checklist, which multipart cannot carry as an object", async () => {
    await qualityApi.recordInspection({ ...base, criteria_scores: { dust: 80 } });
    const body = lastCall().init.body as FormData;
    expect(JSON.parse(body.get("criteria_scores") as string)).toEqual({ dust: 80 });
  });
});

describe("qualityApi.createVerification", () => {
  // Regression: `room_number` was declared required on the input type but
  // never appended to the form, so every call this wrapper made was rejected
  // server-side. Kept covered even though the web now writes inspections
  // through recordInspection -- a dormant wrapper that cannot succeed is a
  // trap for whoever calls it next.
  it("appends the room number the server requires", async () => {
    await qualityApi.createVerification({
      assignment_id: "a1",
      room_number: "412",
      score: 90,
    });
    const body = lastCall().init.body as FormData;
    expect(body.get("room_number")).toBe("412");
  });

  // The worker's half of CRR §14, web-side since 2026-09-01. The worker app
  // has posted this since the feature shipped; the web had no method at all,
  // so a worker on a laptop could see "rework pending" and had no way to
  // clear it. Wire-level because everything that matters here -- the field
  // NAME the server reads the files from, and the absence of any worker_id
  // (self-scoped server-side) -- is invisible to tsc once it is FormData.
  it("posts rework photos under the field name the server reads", async () => {
    const photo = new File(["x"], "fixed.jpg", { type: "image/jpeg" });
    await qualityApi.completeRework("rework-assignment-1", [photo]);

    const { url, init } = lastCall();
    expect(url).toBe("/api/v1/quality/rework/rework-assignment-1/complete");
    expect(init.method).toBe("POST");

    const body = init.body as FormData;
    expect(body.getAll("photos")).toHaveLength(1);
    // Never sent: the server takes the worker from the assignment, and a
    // client-supplied one would be an authorization input.
    expect(body.get("worker_id")).toBeNull();
  });
});

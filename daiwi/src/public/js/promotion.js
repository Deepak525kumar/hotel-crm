/**
 * Promotion board: drag a build card into a platform box to make it live.
 *
 * Dragging is the primary gesture but never the only one — HTML5 drag-and-drop
 * does not fire on touch screens at all, and is awkward with a keyboard. Every
 * card therefore also has a "Make live" button and responds to Enter/Space, and
 * all three paths call the same promote().
 */
// Absolute, from the server-rendered mount path: a relative "api/promote" would
// resolve differently the moment the page URL gained a trailing slash.
const API_BASE = document.getElementById("slotGrid").dataset.api;

const toast = document.getElementById("toast");
let toastTimer;

function showToast(message, isError) {
  toast.textContent = message;
  toast.classList.toggle("toast-error", !!isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3200);
}

async function promote(buildId, channel, platform) {
  try {
    const res = await fetch(`${API_BASE}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildId, channel, platform }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      showToast(body.error || `Could not promote (${res.status}).`, true);
      return;
    }
    if (body.unchanged) {
      showToast("That build is already live.");
      return;
    }
    // Reloaded rather than patched in place: promoting changes the live box, the
    // "live" badges, and the candidate buttons, and a partial update that missed
    // one would misreport what workers are actually downloading.
    window.location.reload();
  } catch {
    showToast("Could not promote — network error.", true);
  }
}

async function clearSlot(channel, platform) {
  if (!confirm("Take this build offline? The public install page will show nothing for this platform until you promote another.")) return;

  try {
    const res = await fetch(`${API_BASE}/promote/${channel}/${platform}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showToast(body.error || `Could not take offline (${res.status}).`, true);
      return;
    }
    window.location.reload();
  } catch {
    showToast("Could not take offline — network error.", true);
  }
}

// ── drag source ───────────────────────────────────────────────────────────────

document.querySelectorAll(".candidate").forEach((card) => {
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        buildId: card.dataset.buildId,
        platform: card.dataset.platform,
        channel: card.dataset.channel,
      })
    );
    // text/plain as well: some browsers refuse a drag with no plain-text payload.
    e.dataTransfer.setData("text/plain", card.dataset.buildId);
    card.classList.add("dragging");
  });

  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  card.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    promote(card.dataset.buildId, card.dataset.channel, card.dataset.platform);
  });
});

// ── drop targets ──────────────────────────────────────────────────────────────

document.querySelectorAll(".slot-box").forEach((box) => {
  const boxPlatform = box.dataset.platform;
  const boxChannel = box.dataset.channel;

  function payloadFrom(e) {
    try {
      return JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return null;
    }
  }

  box.addEventListener("dragover", (e) => {
    // preventDefault is what marks this element as a valid drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    box.classList.add("drag-over");
  });

  box.addEventListener("dragleave", (e) => {
    // Ignore the dragleave fired when moving between the box's own children.
    if (box.contains(e.relatedTarget)) return;
    box.classList.remove("drag-over");
  });

  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("drag-over");

    const payload = payloadFrom(e);
    if (!payload?.buildId) return;

    // Checked here too so the wrong-box case reads instantly rather than after a
    // round trip. The server enforces the same rule from the build row.
    if (payload.platform !== boxPlatform) {
      showToast(
        `That is an ${payload.platform === "IOS" ? "iOS" : "Android"} build — drop it in the ${payload.platform === "IOS" ? "iOS" : "Android"} box.`,
        true
      );
      return;
    }

    promote(payload.buildId, boxChannel, boxPlatform);
  });
});

document.querySelectorAll(".promote-btn").forEach((btn) =>
  btn.addEventListener("click", () => promote(btn.dataset.buildId, btn.dataset.channel, btn.dataset.platform))
);

document.querySelectorAll(".clear-btn").forEach((btn) =>
  btn.addEventListener("click", () => clearSlot(btn.dataset.channel, btn.dataset.platform))
);

document.querySelectorAll(".copy-btn").forEach((btn) =>
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.url);
      showToast("Link copied.");
    } catch {
      showToast("Could not copy link.", true);
    }
  })
);

/**
 * Version Control dashboard. Loaded as a file, not inlined: the CSP forbids
 * inline script and inline event handlers (see server.ts).
 *
 * Every URL this talks to comes from a data- attribute rendered server-side,
 * so the mount path (ADMIN_PATH) is never hardcoded here.
 */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const notesInput = document.getElementById("notesInput");
const minOsInput = document.getElementById("minOsInput");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const uploadError = document.getElementById("uploadError");
const toast = document.getElementById("toast");

let toastTimer;
function showToast(message, isError) {
  toast.textContent = message;
  toast.classList.toggle("toast-error", !!isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3200);
}

const uploadUrl = dropzone.dataset.uploadUrl;
const buildsApi = uploadUrl.replace(/\/upload$/, "");

dropzone.addEventListener("click", (e) => {
  if (e.target === notesInput || e.target === minOsInput) return;
  fileInput.click();
});

["dragover", "dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.toggle("dragover", evt === "dragover");
  })
);

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) uploadFile(fileInput.files[0]);
  // Cleared so picking the same file twice in a row still fires `change`.
  fileInput.value = "";
});

/**
 * No channel is asked for. It is read off the binary while the build parses
 * (see src/lib/detectChannel.ts) and can be corrected afterwards from the build
 * card, which keeps the common case to a single drag.
 */
function uploadFile(file) {
  uploadError.textContent = "";

  if (!/\.(ipa|apk)$/i.test(file.name)) {
    uploadError.textContent = "Only .ipa and .apk files are supported.";
    return;
  }

  const form = new FormData();
  // Fields before the file: the server reads notes/minOsOverride as they
  // arrive, and a field appended after a multi-hundred-megabyte file part
  // would not be parsed until the upload had already finished.
  form.append("notes", notesInput.value);
  form.append("minOsOverride", minOsInput.value);
  form.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", uploadUrl);
  progressWrap.hidden = false;
  progressBar.style.width = "0%";

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) progressBar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
  };

  xhr.onload = () => {
    progressWrap.hidden = true;
    if (xhr.status >= 200 && xhr.status < 300) {
      window.location.reload();
      return;
    }
    try {
      uploadError.textContent = JSON.parse(xhr.responseText).error ?? "Upload failed.";
    } catch {
      uploadError.textContent = `Upload failed (${xhr.status}).`;
    }
  };

  xhr.onerror = () => {
    progressWrap.hidden = true;
    uploadError.textContent = "Upload failed — network error.";
  };

  xhr.send(form);
}

document.querySelectorAll(".copy-btn").forEach((btn) =>
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => (btn.textContent = "Copy link"), 1400);
  })
);

const qrDialog = document.getElementById("qrDialog");
const qrImage = document.getElementById("qrImage");
document.querySelectorAll(".qr-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    qrImage.src = btn.dataset.qr;
    qrDialog.showModal();
  })
);
document.getElementById("qrClose")?.addEventListener("click", () => qrDialog.close());

// Corrects the detector. Recorded as a manual choice, so a re-parse cannot undo it.
document.querySelectorAll(".channel-btn").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const res = await fetch(`${buildsApi}/${btn.dataset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: btn.dataset.channel }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return showToast(body.error || "Could not change the channel.", true);
    showToast(`Moved to ${btn.dataset.label}.`);
    window.location.reload();
  })
);

document.querySelectorAll(".delete-btn").forEach((btn) =>
  btn.addEventListener("click", async () => {
    if (!confirm("Delete this release? The binary is removed and the link stops working. The history record is kept.")) return;
    const res = await fetch(`${buildsApi}/${btn.dataset.id}`, { method: "DELETE" });
    if (res.ok) window.location.reload();
    else showToast("Delete failed.", true);
  })
);

// Poll for status transitions (PARSING -> READY/FAILED) without a full reload.
// Parsing an IPA takes a few seconds; the page reloads once it settles.
const pending = document.querySelectorAll('.build-card[data-status="PARSING"], .build-card[data-status="UPLOADING"]');
if (pending.length) {
  let attempts = 0;
  const poll = setInterval(async () => {
    // Give up after five minutes rather than polling a dead tab forever.
    if (++attempts > 100) return clearInterval(poll);

    const res = await fetch(buildsApi);
    if (!res.ok) return clearInterval(poll);

    const builds = await res.json();
    let stillPending = false;
    for (const b of builds) {
      const card = document.querySelector(`.build-card[data-id="${b.id}"]`);
      if (!card) continue;
      if (b.status !== card.dataset.status) {
        clearInterval(poll);
        window.location.reload();
        return;
      }
      if (b.status === "PARSING" || b.status === "UPLOADING") stillPending = true;
    }
    if (!stillPending) clearInterval(poll);
  }, 3000);
}

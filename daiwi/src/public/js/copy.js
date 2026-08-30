/**
 * Copy-to-clipboard for the public install pages. Loaded as a file rather than
 * inlined because the CSP forbids inline script (see server.ts).
 */
document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const url = btn.dataset.url || window.location.href;
    const label = btn.querySelector(".row-label") || btn;
    const original = label.textContent;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // navigator.clipboard is undefined on insecure origins and older in-app
      // browsers — exactly where people need the link most, so fall back.
      const field = document.createElement("textarea");
      field.value = url;
      field.setAttribute("readonly", "");
      field.style.position = "absolute";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand("copy");
      } catch {
        label.textContent = "Press and hold the link to copy";
        setTimeout(() => (label.textContent = original), 2500);
        document.body.removeChild(field);
        return;
      }
      document.body.removeChild(field);
    }

    label.textContent = "Copied!";
    setTimeout(() => (label.textContent = original), 1400);
  });
});

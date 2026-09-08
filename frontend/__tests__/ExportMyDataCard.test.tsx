import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportMyDataCard } from "@/components/settings/ExportMyDataCard";
import { reportsApi } from "@/lib/api";
// Side-effect import: initialises i18next so `t()` resolves real copy rather
// than the raw key path.
import "@/lib/i18n";

/**
 * "Export my data" — the Article 15/20 right of access, as a button.
 *
 * The states worth testing are the ones a person actually hits and that are
 * easy to get wrong: the file is a LINK rather than bytes, the link can
 * legitimately be absent, and the whole thing must never grow a role check.
 */

jest.mock("@/lib/api", () => ({
  reportsApi: { exportMine: jest.fn() },
}));

const exportMine = reportsApi.exportMine as jest.MockedFunction<typeof reportsApi.exportMine>;

const REPORT = {
  filename: "own-data-2026-09-08.xlsx",
  url: "https://example.test/reports/abc.xlsx",
  format: "xlsx" as const,
  rowCount: 42,
  truncated: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  // jsdom has no window.open; the component calls it on success.
  window.open = jest.fn();
});

it("offers the export without asking who is asking", () => {
  // No role prop, no permission prop, no gate. Workers and checkers are the
  // people most likely to want their own record and least likely to be given
  // it another way; the backend token is held by every role for that reason.
  render(<ExportMyDataCard />);
  expect(screen.getByRole("button", { name: /export my data/i })).toBeInTheDocument();
});

it("hands back a real link, and opens it", async () => {
  exportMine.mockResolvedValue(REPORT);
  render(<ExportMyDataCard />);

  await userEvent.click(screen.getByRole("button", { name: /export my data/i }));

  const link = await screen.findByRole("link", { name: REPORT.filename });
  expect(link).toHaveAttribute("href", REPORT.url);
  // Cross-origin presigned URL: `download` is ignored there, so a new tab is
  // the honest behaviour rather than a link that silently does nothing.
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  expect(window.open).toHaveBeenCalledWith(REPORT.url, "_blank", "noopener,noreferrer");
});

/**
 * The link SURVIVES on screen after being opened. A popup blocker may have
 * swallowed window.open, and the URL expires — a person who missed it needs
 * something to click, not a button to press again.
 */
it("leaves the link on screen rather than only opening a tab", async () => {
  exportMine.mockResolvedValue(REPORT);
  render(<ExportMyDataCard />);

  await userEvent.click(screen.getByRole("button", { name: /export my data/i }));
  expect(await screen.findByRole("link", { name: REPORT.filename })).toBeVisible();
});

/**
 * A null URL is a REAL state: storage unconfigured on the server. Rendering a
 * dead link, or claiming success, would both be worse than saying so.
 */
it("says the file cannot be handed over when storage is unconfigured", async () => {
  exportMine.mockResolvedValue({ ...REPORT, url: null });
  render(<ExportMyDataCard />);

  await userEvent.click(screen.getByRole("button", { name: /export my data/i }));

  expect(await screen.findByText(/file storage is not set up/i)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(window.open).not.toHaveBeenCalled();
});

it("reports a failure instead of appearing to succeed", async () => {
  exportMine.mockRejectedValue(new Error("Report generation failed"));
  render(<ExportMyDataCard />);

  await userEvent.click(screen.getByRole("button", { name: /export my data/i }));

  expect(await screen.findByText(/report generation failed/i)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("disables the button while the file is being built", async () => {
  let release: (value: typeof REPORT) => void = () => {};
  exportMine.mockReturnValue(new Promise((resolve) => { release = resolve; }));

  render(<ExportMyDataCard />);
  const button = screen.getByRole("button", { name: /export my data/i });
  await userEvent.click(button);

  // A year of history takes a moment to assemble; a second click would build
  // and store a second identical workbook.
  await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());

  release(REPORT);
  await screen.findByRole("link", { name: REPORT.filename });
});

/**
 * The outcome is a link appearing below a button — a purely visual cue a
 * screen reader would not otherwise announce.
 */
it("announces the outcome to assistive technology", async () => {
  exportMine.mockResolvedValue(REPORT);
  const { container } = render(<ExportMyDataCard />);

  expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /export my data/i }));
  const live = container.querySelector('[aria-live="polite"]');
  await waitFor(() => expect(live?.textContent ?? "").toMatch(/ready/i));
});

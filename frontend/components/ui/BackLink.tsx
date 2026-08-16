import { useTranslation } from "react-i18next";
import { TextLink, type TextLinkProps } from "@/components/ui/TextLink";
import { useLocaleStore } from "@/stores/locale";
import { dirFor } from "@/lib/locales";

type Direction = "back" | "forward";

/**
 * The arrow character for a given semantic direction under the active locale.
 *
 * Exported for the handful of call sites that are not links -- a pagination
 * `<Button>`, a `<span>` inside a button -- so every arrow in the app resolves
 * its direction from one place rather than each re-deciding.
 */
export function useDirectionalArrow(direction: Direction = "back"): string {
  const locale = useLocaleStore((s) => s.locale);
  const rtl = dirFor(locale) === "rtl";
  return direction === "back" ? (rtl ? "→" : "←") : rtl ? "←" : "→";
}

/**
 * A navigation link whose arrow follows the writing direction.
 *
 * The arrows were previously literal `←` / `→` characters baked into each
 * page's own JSX -- correct for LTR, backwards under RTL, where "back" reads
 * toward the right. Found while extracting these strings for translation:
 * the character was never conditional on anything, in any of the ~28 places
 * it had been copy-pasted.
 *
 * Centralizing does two things at once: the arrow flips with
 * `dirFor(locale)` -- the same source `LocaleProvider` uses for `<html dir>`,
 * not a second one -- and the label always resolves through `t()` rather than
 * being re-typed as a literal at each call site.
 */
export function BackLink({
  labelKey,
  direction = "back",
  className,
  ...props
}: Omit<TextLinkProps, "children"> & { labelKey: string; direction?: Direction }) {
  const { t } = useTranslation();
  // "Back" points against the reading direction, "forward" points with it.
  const arrow = useDirectionalArrow(direction);

  return (
    <TextLink className={className} {...props}>
      {direction === "back" ? (
        <>
          {arrow} {t(labelKey)}
        </>
      ) : (
        <>
          {t(labelKey)} {arrow}
        </>
      )}
    </TextLink>
  );
}

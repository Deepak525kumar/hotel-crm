/**
 * Orla's mark.
 *
 * The launcher used a generic `MessageCircle` from lucide, which is the icon
 * every chat widget on the internet uses. It said "there is a chat here" and
 * nothing about WHAT this is -- and the assistant had been named Orla
 * without the name appearing anywhere a user could see it.
 *
 * The mark is a speech bubble with an O inside it: the bubble says what the
 * thing does at a glance, the O says which thing it is. Drawn as inline
 * SVG rather than pulled from an icon set, because a brand mark that ships in
 * an icon library is by definition not a brand mark.
 *
 * THE MARK WAS A "Z" FOR "ZELLE" UNTIL 2026-10-01. Zelle is the US bank-owned
 * P2P payments network; Apple rejected FHM Checker under guideline 2.3.1(a)
 * for shipping undisclosed "financial brand functionality", which is what a
 * hotel app carrying that name and a Z badge reads as. The web app was never
 * reviewed by Apple, but a mark is a mark across surfaces -- leaving the Z
 * here would keep the association alive everywhere the mobile apps dropped it.
 *
 * `currentColor` throughout, so one component serves the white-on-blue
 * launcher, the header, and any future placement without a colour prop.
 * `strokeLinecap="round"` matches the weight of the lucide icons it sits
 * beside -- a mark that looks welded on is worse than the generic one.
 */
export function OrlaMark({
  className,
  title,
}: {
  className?: string;
  /** Omit inside a labelled control -- the parent's label already names it. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* The bubble: rounded, with a tail at the lower left so it reads as
          speech rather than as a plain rounded square. */}
      <path d="M20.5 11.7c0 4.2-3.8 7.6-8.5 7.6a9.7 9.7 0 0 1-2.4-.3L4.8 21l1.2-3.5a7.2 7.2 0 0 1-2.5-5.4c0-4.2 3.8-7.6 8.5-7.6s8.5 3.4 8.5 7.6Z" />
      {/* The O, sized to sit optically centred in the bubble rather than
          geometrically centred -- the tail pulls the eye down-left.

          A circle, not a letter in a font: the mark has to hold at 16px in a
          header and at 24px on the launcher, and text scaled between those
          two sizes does not keep its stroke weight against the bubble it
          sits in. Radius 2.6 leaves a ring of bubble visible all the way
          round at the smallest size actually used. */}
      <circle cx="12" cy="11.7" r="2.6" />
    </svg>
  );
}

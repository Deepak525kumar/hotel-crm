/**
 * Zelle's mark.
 *
 * The launcher used a generic `MessageCircle` from lucide, which is the icon
 * every chat widget on the internet uses. It said "there is a chat here" and
 * nothing about WHAT this is -- and the assistant had been named Zelle
 * without the name appearing anywhere a user could see it.
 *
 * The mark is a speech bubble with a Z cut through it: the bubble says what
 * the thing does at a glance, the Z says which thing it is. Drawn as inline
 * SVG rather than pulled from an icon set, because a brand mark that ships in
 * an icon library is by definition not a brand mark.
 *
 * `currentColor` throughout, so one component serves the white-on-blue
 * launcher, the header, and any future placement without a colour prop.
 * `strokeLinecap="round"` matches the weight of the lucide icons it sits
 * beside -- a mark that looks welded on is worse than the generic one.
 */
export function ZelleMark({
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
      {/* The Z, sized to sit optically centred in the bubble rather than
          geometrically centred -- the tail pulls the eye down-left. */}
      <path d="M9.2 9.1h5.6l-5.6 5.2h5.6" />
    </svg>
  );
}

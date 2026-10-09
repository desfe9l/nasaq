import { cn } from "@/lib/utils";
import { useReveal } from "./useReveal";

export type SectionProps = React.HTMLAttributes<HTMLElement> & {
  eyebrow?: string;
  title?: string;
  description?: string;
  /** When true, the section background alternates (surface-2 band). */
  band?: boolean;
  /** Animation order index for staggered reveals (0 = first). */
  revealOrder?: number;
};

/**
 * A page section with consistent rhythm, optional heading, and entrance reveal.
 * Provides the editorial spacing and typography hierarchy for all marketing
 * pages. `band` alternates the background surface so sections read as distinct
 * editorial blocks rather than a flat scroll.
 */
export function Section({
  eyebrow,
  title,
  description,
  band = false,
  revealOrder = 0,
  className,
  children,
  ...props
}: SectionProps) {
  const [ref, visible] = useReveal<HTMLElement>({
    delay: revealOrder * 80,
  });

  return (
    <section
      ref={ref}
      className={cn(
        "nsq-section",
        band ? "bg-surface-2" : "bg-page",
        visible ? "is-revealed" : "",
        className,
      )}
      data-animate
      {...props}
    >
      <div className="nsq-container py-[var(--section-py_sm,_2.5rem)] sm:py-[var(--section-py,_3.5rem)]">
        {(eyebrow || title || description) && (
          <header className="mb-10 sm:mb-12">
            {eyebrow && (
              <p className="nsq-section-eyebrow">{eyebrow}</p>
            )}
            {title && (
              <h2
                className={cn(
                  "nsq-section-title mt-2.5 text-[1.45rem] leading-[1.3] sm:text-[1.75rem]",
                  !eyebrow && "mt-0",
                )}
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                className={cn(
                  "mt-3 max-w-2xl text-[0.9rem] leading-[1.55] text-muted",
                  !title && !eyebrow && "mt-0",
                )}
              >
                {description}
              </p>
            )}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { FadeIn } from '@/components/amicro/fade-in';
import { FadeUp } from '@/components/amicro/fade-up';

export function Enter({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <FadeUp duration={0.2} delay={delay} yOffset={8} className={className}>
      {children}
    </FadeUp>
  );
}

export function EnterIn({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <FadeIn duration={0.2} className={className}>
      {children}
    </FadeIn>
  );
}

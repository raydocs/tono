import { cn } from '@/lib/utils';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Printed after the label; a count the list under the switch must agree with. */
  count?: number;
};

/**
 * One choice out of a few, as pressed buttons in a labelled group: a range
 * (24 小时 / 7 天) or a filter over a list. Buttons rather than a radio group
 * because every option is one click that changes the page, and the count
 * beside a filter is part of its name so a screen reader hears "有问题 7".
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('quality-range', className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className="quality-range-btn"
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count === undefined ? null : (
            <span className="segmented-count font-mono">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The spoken half of a copy button.
 *
 * The button's label swaps from "copy" to "copied", which a screen reader does
 * not announce because focus never moves. This region sits beside the button,
 * is always in the page (a live region added together with its text is
 * skipped), and says the outcome word once the clipboard write has landed.
 */
export function CopyStatus({ copied, message }: { copied: boolean; message: string }) {
  return <span role="status" className="sr-only">{copied ? message : ''}</span>;
}

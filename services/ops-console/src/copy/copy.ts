/**
 * Every word the console is allowed to say, and the only place any of them
 * is written.
 *
 * One flat object because that is how it is read — `copy.periodTraffic`, never
 * `copy.nodes.periodTraffic` — and four files because a page's vocabulary is
 * edited when that page is, and one 450-line list was over the size budget.
 * The eslint rule `ops/no-implementation-note-copy` keeps CJK out of every
 * source but this directory; `copy.test.ts` keeps implementation words out of
 * the directory itself.
 */
import { clientCopy } from './clients';
import { customerBoardCopy } from './customer-board';
import { ledgerCopy } from './ledger';
import { nodeBoardCopy } from './node-board';
import { nodeDetailCopy } from './node-detail';
import { nodesBoardCopy } from './nodes-board';
import { panelCopy } from './panel';
import { qualityCopy } from './quality';
import { residentialCopy } from './residential';
import { settingsCopy } from './settings';
import { settingsPublishCopy } from './settings-publish';
import { customerCopy } from './customers';
import { diagnosticsCopy } from './diagnostics';
import { shellCopy } from './shell';
import { todayCopy } from './today';
import { worthwhileCopy } from './worthwhile';
import { trafficCopy } from './traffic';
import { customerSloCopy } from './customer-slo';
import { hy2SwitchCopy } from './hy2-switch';

export const copy = {
  ...shellCopy,
  ...customerCopy,
  ...todayCopy,
  ...clientCopy,
  settings: { ...settingsCopy, ...settingsPublishCopy },
  ...ledgerCopy,
  ...nodeDetailCopy,
  ...nodesBoardCopy,
  ...nodeBoardCopy,
  ...worthwhileCopy,
  ...panelCopy,
  ...diagnosticsCopy,
  ...qualityCopy,
  ...residentialCopy,
  ...customerBoardCopy,
  ...trafficCopy,
  ...customerSloCopy,
  ...hy2SwitchCopy,
} as const;


export type PageId = keyof typeof copy.pages;

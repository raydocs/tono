import { useEffect, useState } from 'react';
import { defaultFilter } from 'cmdk';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { CustomerSummaryDto, FunnelDto, IncidentDto, NodeSummaryDto } from '@contract';
import { copy, type PageId } from '@/copy/copy';
import { invitesOf } from '@/lib/funnel';
import { goPage, openCustomer, openIncident, openInvite, openNode } from '@/lib/hash-route';
import { openIncidents } from '@/lib/incidents';
import { usePrivacy } from '@/lib/privacy';
import { can, currentRole, PAGE_REQUIRES } from '@/lib/roles';

const PAGE_IDS = Object.keys(copy.pages) as PageId[];

// Identifiers select a row; only its displayed address/known handle are searchable.
const filter = (value: string, search: string, keywords?: string[]) => (
  defaultFilter(keywords?.length ? keywords.join(' ') : value, search)
);

/**
 * Four things to type at: a page, an open incident, a customer, a machine.
 *
 * The node list is the engine's, not the legacy fleet read's, so ⌘K and the
 * nodes page hold the same fleet — a machine the console will not show you is a
 * machine you cannot jump to either.
 */
export function CommandPalette({
  nodes,
  customers,
  funnel,
  incidents,
}: {
  nodes: NodeSummaryDto[];
  customers: CustomerSummaryDto[];
  funnel: FunnelDto | null;
  incidents: IncidentDto[];
}) {
  const [open, setOpen] = useState(false);
  const privacy = usePrivacy();
  const role = currentRole();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <CommandDialog filter={filter} open={open} onOpenChange={setOpen} title={copy.searchPrompt} description={copy.searchPrompt}>
      <CommandInput placeholder={copy.searchPrompt} />
      <CommandList>
        <CommandEmpty>{copy.commandEmpty}</CommandEmpty>
        <CommandGroup heading={copy.commandPages}>
          {PAGE_IDS.filter((id) => can(PAGE_REQUIRES[id], role)).map((id) => (
            <CommandItem
              key={id}
              value={`${copy.pages[id]} ${id}`}
              onSelect={() => {
                goPage(id);
                setOpen(false);
              }}
            >
              {copy.pages[id]}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={copy.commandIncidents}>
          {openIncidents(incidents).map((incident) => (
            <CommandItem
              key={incident.id}
              value={`${incident.title} ${incident.subjectId ?? ''}`}
              onSelect={() => {
                openIncident(incident.id);
                setOpen(false);
              }}
            >
              {incident.title}
            </CommandItem>
          ))}
        </CommandGroup>
        {/* The address is matched exactly as it is shown — masking the label
            while searching the real one would print it back on the first
            keystroke. The WeChat id goes the other way: it is matched on the
            real handle, because typing a handle you already know is the whole
            reason to reach for ⌘K, and the row beside it still reads masked. */}
        <CommandGroup heading={copy.commandCustomers}>
          {customers.map((customer) => (
            <CommandItem
              key={JSON.stringify([customer.userId, privacy.privacy, customer.email, customer.wechatId])}
              value={`customer:${customer.userId}`}
              keywords={[
                privacy.privacy ? privacy.email(customer.email) : customer.email,
                customer.wechatId ?? '',
              ]}
              onSelect={() => {
                openCustomer(customer.userId);
                setOpen(false);
              }}
            >
              {customer.wechatId === null
                ? privacy.email(customer.email)
                : `${privacy.email(customer.email)} · ${privacy.wechat(customer.wechatId)}`}
            </CommandItem>
          ))}
        </CommandGroup>
        {/* Somebody who was opened and never registered has no customer row
            and no page, and is exactly the person an operator is looking for
            when they type a handle they wrote down this morning. Matched the
            same way as a customer — the real handle, the shown address — and
            landing on the drawer, which is all there is of them. */}
        <CommandGroup heading={copy.commandInvites}>
          {invitesOf(funnel).map((row) => (
            <CommandItem
              key={JSON.stringify([row.key, privacy.privacy, row.email, row.wechatId])}
              value={`invite:${row.key}`}
              keywords={[
                privacy.privacy ? privacy.email(row.email) : row.email,
                row.wechatId ?? '',
              ]}
              onSelect={() => {
                openInvite(row.email);
                setOpen(false);
              }}
            >
              {row.wechatId === null
                ? privacy.email(row.email)
                : `${privacy.email(row.email)} · ${privacy.wechat(row.wechatId)}`}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={copy.commandNodes}>
          {nodes.map((node) => (
            <CommandItem
              key={node.name}
              value={node.name}
              onSelect={() => {
                openNode(node.name);
                setOpen(false);
              }}
            >
              {node.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

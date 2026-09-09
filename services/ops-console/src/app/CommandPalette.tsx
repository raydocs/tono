import { useEffect, useState } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { copy, type PageId } from '@/copy/copy';
import { goPage, openNode } from '@/lib/hash-route';
import type { FleetNodeDto } from '@/lib/types';

const PAGE_IDS = Object.keys(copy.pages) as PageId[];

export function CommandPalette({ nodes }: { nodes: FleetNodeDto[] }) {
  const [open, setOpen] = useState(false);

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
    <CommandDialog open={open} onOpenChange={setOpen} title={copy.searchPrompt} description={copy.searchPrompt}>
      <CommandInput placeholder={copy.searchPrompt} />
      <CommandList>
        <CommandEmpty>{copy.commandEmpty}</CommandEmpty>
        <CommandGroup heading={copy.commandPages}>
          {PAGE_IDS.map((id) => (
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

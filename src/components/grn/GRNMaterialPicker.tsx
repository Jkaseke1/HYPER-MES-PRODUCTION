import { useState } from 'react';
import { Check, ChevronDown, FlaskConical, Layers, Package, Wheat } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { grnMaterialGroup, grnMaterialGroups, isGrnInput } from '../../lib/grnMaterials';
import type { RawMaterial } from '../../types/database';

const groupIcons = { 'Raw materials': Wheat, Packaging: Package, Premixes: Layers, 'Additives & minerals': FlaskConical };

export default function GRNMaterialPicker({ materials, finishedCodes, value, disabled, onSelect }: {
  materials: RawMaterial[]; finishedCodes: Set<string>; value: string; disabled: boolean; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const eligible = materials.filter((material) => isGrnInput(material, finishedCodes));
  const selected = eligible.find((material) => material.id === value);
  const SelectedIcon = selected ? groupIcons[grnMaterialGroup(selected)] : Package;
  const query = search.trim().toLowerCase();
  const matches = eligible.filter((material) => (category === 'All' || grnMaterialGroup(material) === category)
    && `${material.name} ${material.code} ${(material as RawMaterial & { sage_code?: string }).sage_code || ''}`.toLowerCase().includes(query));
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setSearch(''); setCategory('All'); } }}>
    <PopoverTrigger asChild>
      <button type="button" role="combobox" aria-expanded={open} aria-label="Select GRN material" disabled={disabled}
        className="flex min-h-12 w-full items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50">
        <SelectedIcon className="h-5 w-5 shrink-0 text-teal-700" />
        <span className="min-w-0 flex-1 break-words">{selected ? <><span className="block font-semibold text-slate-900">{selected.name}</span><span className="font-mono text-xs text-slate-500">{selected.code}</span></> : <span className="text-slate-500">{disabled ? 'Loading input catalogue...' : 'Search material name or code'}</span>}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[640px] max-w-[calc(100vw-32px)] overflow-hidden border-slate-200 p-0 shadow-xl">
      <Command shouldFilter={false}>
        <div className="bg-slate-950 px-4 py-3 text-sm font-semibold text-white">GRN input catalogue <span className="ml-2 text-xs font-normal text-teal-300">{eligible.length} items</span></div>
        <CommandInput value={search} onValueChange={setSearch} placeholder="Search material name, item code or Sage code..." className="h-12 text-sm" />
        <div role="group" aria-label="Material categories" className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-slate-50 p-3">
          {['All', ...grnMaterialGroups].map((group) => {
            const Icon = group === 'All' ? Layers : groupIcons[group as keyof typeof groupIcons];
            return <button type="button" key={group} aria-pressed={category === group} onClick={() => setCategory(group)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium ${category === group ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white'}`}>
              <Icon className="h-4 w-4" />{group}
            </button>;
          })}
        </div>
        <CommandList className="max-h-[360px] overflow-y-auto overscroll-contain p-2">
          <CommandEmpty>No matching inputs</CommandEmpty>
          {grnMaterialGroups.map((group) => {
            const rows = matches.filter((material) => grnMaterialGroup(material) === group);
            const Icon = groupIcons[group];
            return rows.length ? <CommandGroup key={group} heading={<span className="flex items-center gap-2 text-teal-800"><Icon className="h-4 w-4" />{group}<span className="text-slate-400">{rows.length}</span></span>}>
              {rows.map((material) => <CommandItem key={material.id} value={material.id} onSelect={() => { onSelect(material.id); setOpen(false); }} className="min-h-14 gap-3 px-3 py-2 data-[selected=true]:bg-teal-50">
                <Icon className="h-5 w-5 shrink-0 text-teal-600" />
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-900">{material.name}</span><span className="font-mono text-xs text-slate-500">{material.code}</span></span>
                <span className="shrink-0 text-xs text-slate-500">{material.unit}</span>
                {value === material.id && <Check className="h-4 w-4 shrink-0 text-teal-700" />}
              </CommandItem>)}
            </CommandGroup> : null;
          })}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}

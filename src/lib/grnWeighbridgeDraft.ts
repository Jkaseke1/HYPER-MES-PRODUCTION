type Ticket = { product_code?: string | null; status?: string; driver_signed?: boolean; nett_mass?: number | string | null };
type Material = { id: string; code: string; sage_code?: string | null; unit?: string; is_active?: boolean };

export function grnLineFromWeighbridge<T extends Material>(ticket: Ticket, eligibleMaterials: T[]) {
  if (!['open', 'in_grn', 'linked'].includes(ticket.status || '')) throw new Error('The weighbridge ticket is not available.');
  const code = (ticket.product_code || '').trim().toUpperCase();
  if (!code) throw new Error('No product is recorded on this weighbridge ticket. Select the material from the receipt documents.');
  const matches = eligibleMaterials.filter(material => material.is_active !== false &&
    [material.code, material.sage_code].some(value => value?.trim().toUpperCase() === code));
  if (matches.length !== 1) throw new Error('The ticket product does not match one active GRV input. Select the material from the receipt documents.');
  const material = matches[0];
  const mass = Number(ticket.nett_mass);
  // Weighbridge kg cannot establish bag/unit counts or an unsigned receipt quantity.
  const useNetKg = ticket.driver_signed === true && Number.isFinite(mass) && mass > 0 &&
    ['kg', 'kgs', 'kilogram', 'kilograms'].includes((material.unit || '').trim().toLowerCase());
  return { material, receivedQty: useNetKg ? mass : '' as const };
}

export function transporterRegistrationBlocksApproval(status: string | null | undefined): boolean {
  return !['legacy', 'verified', 'not_required'].includes(status || '');
}

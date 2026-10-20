export type ProcurementIntake = {
  title: string;
  business_reason: string;
  priority: string;
  required_by: string;
  description: string;
  quantity: string;
  unit: string;
};

// Match numeric(18,3) without silently rounding a requested quantity.
export function validateProcurementIntake(form: ProcurementIntake): string | null {
  if (!form.title.trim() || !form.business_reason.trim() || !form.description.trim()) {
    return 'Complete the request, business reason, and item details.';
  }
  const quantity = form.quantity.trim();
  if (!/^\d{1,15}(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) {
    return 'Enter a positive quantity with up to 15 whole digits and 3 decimal places.';
  }
  if (!['low', 'normal', 'high', 'critical'].includes(form.priority)) {
    return 'Select a valid priority.';
  }
  if (form.required_by) {
    const date = new Date(`${form.required_by}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.required_by)
      || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== form.required_by) {
      return 'Enter a valid required-by date.';
    }
  }
  return null;
}

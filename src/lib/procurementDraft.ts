import { validateProcurementIntake, type ProcurementIntake } from './procurementIntake';

type Attempt = { key: string; payload: ProcurementIntake };
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type DraftClient = {
  rpc: (name: string, args: { p_submission_key: string; p_payload: ProcurementIntake }) =>
    PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const storageKey = (actor: string) => `procurement-draft-attempt:${actor}`;

export function loadProcurementAttempt(storage: DraftStorage, actor: string): Attempt | null {
  const raw = storage.getItem(storageKey(actor));
  if (!raw) return null;
  let attempt: Attempt;
  try { attempt = JSON.parse(raw) as Attempt; }
  catch { throw new Error('The pending request could not be restored. Check the request register before creating another.'); }
  if (!attempt || typeof attempt.key !== 'string' || !attempt.key || !attempt.payload
    || ['title', 'business_reason', 'priority', 'required_by', 'description', 'quantity', 'unit']
      .some(key => typeof (attempt.payload as unknown as Record<string, unknown>)[key] !== 'string')
    || validateProcurementIntake(attempt.payload)) {
    throw new Error('The pending request could not be restored. Check the request register before creating another.');
  }
  return attempt;
}

export async function saveProcurementDraft(
  client: DraftClient, storage: DraftStorage, actor: string,
  form: ProcurementIntake, newKey: () => string,
): Promise<string> {
  const validation = validateProcurementIntake(form);
  if (validation) throw new Error(validation);
  const payload: ProcurementIntake = {
    title: form.title.trim(), business_reason: form.business_reason.trim(),
    priority: form.priority, required_by: form.required_by,
    description: form.description.trim(), quantity: form.quantity.trim(), unit: form.unit.trim() || 'each',
  };
  const previous = loadProcurementAttempt(storage, actor);
  if (previous && JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
    throw new Error('A previous save is unconfirmed. Restore its details and retry before starting another request.');
  }
  const attempt = previous || { key: newKey(), payload };
  // Persist before sending. Storage failure must prevent a non-recoverable submission.
  storage.setItem(storageKey(actor), JSON.stringify(attempt));
  const { data, error } = await client.rpc('create_maintenance_procurement_draft', {
    p_submission_key: attempt.key, p_payload: attempt.payload,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || !data) throw new Error('Request save could not be confirmed. Retry the same details.');
  storage.removeItem(storageKey(actor));
  return data;
}

import { supabase } from './supabase';

/**
 * Generates auto-incrementing batch numbers with audit trail
 * Format: PREFIX-YYYY-NNNNNN (e.g., DSP-2026-000001, BATCH-2026-000001)
 */

/**
 * Preview the next batch number WITHOUT incrementing the sequence in database.
 * This is used when opening modal forms so opening and closing forms without submitting
 * does NOT consume or skip sequence numbers.
 */
export async function peekBatchNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  try {
    const { data } = await supabase
      .from('batch_sequences')
      .select('next_sequence')
      .eq('prefix', prefix)
      .eq('year', year)
      .maybeSingle();

    const nextSeq = data?.next_sequence || 1;
    const sequenceNumber = String(nextSeq).padStart(6, '0');
    return `${prefix}-${year}-${sequenceNumber}`;
  } catch (err) {
    console.error(`Error peeking batch number for ${prefix}:`, err);
    return `${prefix}-${year}-000001`;
  }
}

/**
 * Get the next sequential batch number for a given prefix.
 * This should ONLY be called when ACTUALLY SUBMITTING / SAVING a record into the database!
 */
export async function generateBatchNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  
  try {
    // 1. Fetch current sequence from batch_sequences table
    const { data } = await supabase
      .from('batch_sequences')
      .select('id, next_sequence')
      .eq('prefix', prefix)
      .eq('year', year)
      .maybeSingle();

    let currentSeq = data?.next_sequence || 1;

    // 2. Increment next_sequence atomically in batch_sequences
    if (data?.id) {
      await supabase
        .from('batch_sequences')
        .update({ next_sequence: currentSeq + 1, updated_at: new Date().toISOString() })
        .eq('id', data.id);
    } else {
      await supabase
        .from('batch_sequences')
        .insert({ prefix, year, next_sequence: currentSeq + 1 });
    }

    const sequenceNumber = String(currentSeq).padStart(6, '0');
    return `${prefix}-${year}-${sequenceNumber}`;
  } catch (err) {
    console.error('Batch number generation failed:', err);
    return `${prefix}-${year}-${Date.now().toString(36).toUpperCase()}`;
  }
}

export async function peekProductionBatchNumber(): Promise<string> {
  return peekMfpNumber();
}

export async function generateProductionBatchNumber(): Promise<string> {
  return generateMfpNumber();
}

async function peekMfpNumber(): Promise<string> {
  try {
    const { data } = await supabase
      .from('batch_sequences')
      .select('next_sequence')
      .eq('prefix', 'MFP')
      .eq('year', 0)
      .maybeSingle();

    return `MFP${String(data?.next_sequence || 1).padStart(6, '0')}`;
  } catch (err) {
    console.error('Error peeking Sage MFP number:', err);
    return 'MFP000001';
  }
}

async function generateMfpNumber(): Promise<string> {
  try {
    // Reuse the existing atomic sequence RPC so this works before the optional
    // Sage-reference migration has been deployed.
    const { data, error } = await supabase.rpc('get_next_batch_sequence', { p_prefix: 'MFP', p_year: 0 });
    if (error || !Number.isInteger(data)) throw error || new Error('MFP sequence did not return a number.');
    const reservedSequence = data - 1;
    if (reservedSequence < 1) throw new Error('Sage MFP sequence is not initialized.');
    return `MFP${String(reservedSequence).padStart(6, '0')}`;
  } catch (err) {
    console.error('Sage MFP number generation failed:', err);
    throw new Error('Could not reserve the next Sage MFP production number. Please try again.');
  }
}

export async function peekDispatchNumber(): Promise<string> {
  return peekBatchNumber('DSP');
}

export async function generateDispatchNumber(): Promise<string> {
  return generateBatchNumber('DSP');
}

export async function peekGRNNumber(): Promise<string> {
  return peekBatchNumber('GRN');
}

export async function generateGRNNumber(): Promise<string> {
  return generateBatchNumber('GRN');
}

export async function generatePONumber(): Promise<string> {
  return generateBatchNumber('PO');
}

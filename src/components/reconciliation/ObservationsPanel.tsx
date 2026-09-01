import { useState } from 'react';
import { Plus, AlertTriangle, Info, AlertOctagon, Trash2 } from 'lucide-react';
import type { ReconObservation } from '../../types/reconciliation';
import { supabase } from '../../lib/supabase';

interface ObservationsPanelProps {
  observations: ReconObservation[];
  periodId: string;
  section: ReconObservation['section'];
  onUpdate: () => void;
  readOnly?: boolean;
}

const severityConfig = {
  info: { icon: Info, bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', iconColor: 'text-blue-500' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-500' },
  critical: { icon: AlertOctagon, bg: 'bg-red-50 border-red-200', text: 'text-red-700', iconColor: 'text-red-500' },
};

export default function ObservationsPanel({ observations, periodId, section, onUpdate, readOnly }: ObservationsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [newObs, setNewObs] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!newObs.trim()) return;
    setSaving(true);
    await supabase.from('recon_observations').insert({
      period_id: periodId,
      section,
      observation: newObs.trim(),
      severity,
    });
    setSaving(false);
    setNewObs('');
    setAdding(false);
    onUpdate();
  }

  async function handleDelete(id: string) {
    await supabase.from('recon_observations').delete().eq('id', id);
    onUpdate();
  }

  const filtered = observations.filter((o) => o.section === section);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Observations & Comments</h4>
        {!readOnly && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {filtered.length === 0 && !adding && (
        <p className="text-sm text-slate-400 py-4 text-center">No observations recorded</p>
      )}

      <div className="space-y-2">
        {filtered.map((obs) => {
          const config = severityConfig[obs.severity];
          const Icon = config.icon;
          return (
            <div key={obs.id} className={`flex items-start gap-3 p-3 rounded-lg border ${config.bg}`}>
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.iconColor}`} />
              <p className={`text-sm flex-1 ${config.text}`}>{obs.observation}</p>
              {!readOnly && (
                <button onClick={() => handleDelete(obs.id)} className="p-1 rounded hover:bg-white/50 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {adding && (
        <div className="mt-3 space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <textarea
            rows={2}
            value={newObs}
            onChange={(e) => setNewObs(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            placeholder="Describe the observation..."
          />
          <div className="flex items-center gap-3">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as 'info' | 'warning' | 'critical')}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={saving || !newObs.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Scale, AlertTriangle, CheckCircle, Truck, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface WeighBridgeData {
  wb_transaction_no: string;
  wb_vehicle_reg: string;
  wb_haulier_code: string;
  wb_product_code: string;
  wb_product_name: string;
  wb_supplier_id: string;
  wb_unregistered_supplier_name: string;
  wb_finance_note: string;
  wb_comment: string;
  wb_trailer_number: string;
  wb_driver_name: string;
  wb_driver_id: string;
  wb_time_in: string;
  wb_first_mass: string;
  wb_time_out: string;
  wb_second_mass: string;
  wb_nett_mass: string;
  wb_driver_signed: boolean;
}

interface WeighBridgeTicketProps {
  data: WeighBridgeData;
  onChange: (field: keyof WeighBridgeData, value: any) => void;
  receivedQty?: number;
  hideHeader?: boolean;
}

const input =
  'w-full px-3 py-2 border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-colors bg-white placeholder:text-slate-400';
const label = 'block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1';

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={label}>{title}</label>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 bg-orange-50 rounded-md flex items-center justify-center border border-orange-100">
        <Icon className="w-3.5 h-3.5 text-orange-700" />
      </div>
      <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">{children}</span>
      <div className="flex-1 border-t border-slate-200" />
    </div>
  );
}

export default function WeighBridgeTicket({ data, onChange, receivedQty, hideHeader }: WeighBridgeTicketProps) {
  const [expanded, setExpanded] = useState(!!hideHeader);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  useEffect(() => {
    // Fetch raw materials (Sage-linked products)
    supabase
      .from('raw_materials')
      .select('id, name, code, sage_code')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setRawMaterials(data || []));

    // Fetch suppliers
    supabase
      .from('suppliers')
      .select('id, name, code')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setSuppliers(data || []));
  }, []);

  const handleMassChange = (field: 'wb_first_mass' | 'wb_second_mass', value: string) => {
    onChange(field, value);
    const first = field === 'wb_first_mass' ? parseFloat(value) : parseFloat(data.wb_first_mass);
    const second = field === 'wb_second_mass' ? parseFloat(value) : parseFloat(data.wb_second_mass);
    if (!isNaN(first) && !isNaN(second)) {
      onChange('wb_nett_mass', String(Math.round(Math.abs(second - first) * 1000) / 1000));
    }
  };

  const nettMass = parseFloat(data.wb_nett_mass);
  const variance =
    !isNaN(nettMass) && nettMass > 0 && receivedQty
      ? Math.abs((nettMass - receivedQty) / nettMass) * 100
      : null;
  const hasWBData = !!data.wb_transaction_no;

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${
      expanded ? 'border-orange-300 shadow-sm' : 'border-slate-200'
      } overflow-hidden`}
    >
      {/* ── Header ── */}
      {!hideHeader && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center justify-between px-5 py-3 transition-colors ${
            expanded ? 'bg-[#09072c]' : 'bg-white hover:bg-orange-50/60'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${expanded ? 'bg-orange-500' : 'bg-orange-50 border border-orange-100'}`}>
              <Scale className={`w-4 h-4 ${expanded ? 'text-white' : 'text-orange-700'}`} />
            </div>
            <div className="text-left">
              <p className={`text-sm font-semibold ${expanded ? 'text-white' : 'text-slate-900'}`}>
                Weigh Bridge Ticket
              </p>
              <p className={`text-xs mt-0.5 ${expanded ? 'text-slate-300' : 'text-slate-500'}`}>
                {hasWBData ? `Ref: ${data.wb_transaction_no}` : 'Optional — expand to capture weighing data'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasWBData && !expanded && (
              <span className="px-2.5 py-0.5 text-xs font-semibold bg-orange-500/15 text-orange-300 rounded-full border border-orange-400/30">
                Captured
              </span>
            )}
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-orange-200" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </div>
        </button>
      )}

      {/* ── Body ── */}
      {expanded && (
        <div className="bg-white px-5 pb-5 pt-4 space-y-4">

          {/* Variance Warning */}
          {variance !== null && variance > 2 && (
            <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300 leading-relaxed">
                <span className="font-bold">Variance Alert — </span>
                Nett mass ({data.wb_nett_mass} kg) differs from received quantity ({receivedQty} kg) by{' '}
                <span className="font-bold">{variance.toFixed(1)}%</span>. Verify before saving.
              </p>
            </div>
          )}

          {/* ── Two Column Layout ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {/* Left: Vehicle & Driver */}
            <div className="space-y-4">
              {/* Vehicle Section */}
              <div>
                <SectionHeader icon={Truck}>Vehicle & Reference</SectionHeader>
                <div className="grid grid-cols-3 gap-2.5">
                  <Field title="Transaction No">
                    <input
                      type="text"
                      value={data.wb_transaction_no}
                      onChange={(e) => onChange('wb_transaction_no', e.target.value)}
                      placeholder="e.g. WB-00123"
                      className={input}
                    />
                  </Field>
                  <Field title="Vehicle Reg">
                    <input
                      type="text"
                      value={data.wb_vehicle_reg}
                      onChange={(e) => onChange('wb_vehicle_reg', e.target.value)}
                      placeholder="e.g. ABC 123 GP"
                      className={input}
                    />
                  </Field>
                  <Field title="Haulier">
                    <select
                      value={data.wb_haulier_code}
                      onChange={(e) => onChange('wb_haulier_code', e.target.value)}
                      className={input}
                    >
                      <option value="">Select…</option>
                      <option value="HYPER">HYPER</option>
                      <option value="External">External</option>
                    </select>
                  </Field>
                  <Field title="Product (Sage) *">
                    <select
                      value={data.wb_product_code}
                      onChange={(e) => {
                        const selected = rawMaterials.find(rm => rm.code === e.target.value);
                        onChange('wb_product_code', e.target.value);
                        onChange('wb_product_name', selected?.name || '');
                      }}
                      className={input}
                    >
                      <option value="">Select product…</option>
                      {rawMaterials.map(rm => (
                        <option key={rm.id} value={rm.code}>
                          {rm.name} ({rm.sage_code || rm.code})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field title="Supplier *">
                    <select
                      value={data.wb_supplier_id}
                      onChange={(e) => {
                        onChange('wb_supplier_id', e.target.value);
                        if (e.target.value) onChange('wb_unregistered_supplier_name', '');
                      }}
                      className={input}
                    >
                      <option value="">Supplier not in system / select supplier…</option>
                      {suppliers.map(sup => (
                        <option key={sup.id} value={sup.id}>
                          {sup.name} ({sup.code})
                        </option>
                      ))}
                    </select>
                  </Field>
                  {!data.wb_supplier_id && (
                    <>
                      <Field title="Supplier Name for Finance *">
                        <input
                          type="text"
                          value={data.wb_unregistered_supplier_name}
                          onChange={(e) => onChange('wb_unregistered_supplier_name', e.target.value)}
                          placeholder="Supplier name as provided at gate"
                          className={input}
                        />
                      </Field>
                      <Field title="Finance Follow-up">
                        <input
                          type="text"
                          value={data.wb_finance_note}
                          onChange={(e) => onChange('wb_finance_note', e.target.value)}
                          placeholder="Contact, invoice, or account setup note"
                          className={input}
                        />
                      </Field>
                    </>
                  )}
                  <Field title="Trailer No">
                    <input
                      type="text"
                      value={data.wb_trailer_number}
                      onChange={(e) => onChange('wb_trailer_number', e.target.value)}
                      placeholder="Trailer number"
                      className={input}
                    />
                  </Field>
                  <Field title="Comment">
                    <input
                      type="text"
                      value={data.wb_comment}
                      onChange={(e) => onChange('wb_comment', e.target.value)}
                      placeholder="Optional note"
                      className={input}
                    />
                  </Field>
                </div>
              </div>

              {/* Driver Section */}
              <div>
                <SectionHeader icon={User}>Driver</SectionHeader>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field title="Driver Name">
                    <input
                      type="text"
                      value={data.wb_driver_name}
                      onChange={(e) => onChange('wb_driver_name', e.target.value)}
                      placeholder="Full name"
                      className={input}
                    />
                  </Field>
                  <Field title="Driver ID / Licence">
                    <input
                      type="text"
                      value={data.wb_driver_id}
                      onChange={(e) => onChange('wb_driver_id', e.target.value)}
                      placeholder="ID or licence number"
                      className={input}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* Right: Weighing */}
            <div className="space-y-4">
              <SectionHeader icon={Scale}>Weighing</SectionHeader>

              {/* Entry / Exit side by side */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-lg bg-orange-50/60 border border-orange-100 space-y-2.5">
                  <p className="text-[10px] font-bold text-orange-800 uppercase tracking-wider">Entry — 1st Weighing</p>
                  <Field title="Time In">
                    <input
                      type="datetime-local"
                      value={data.wb_time_in}
                      onChange={(e) => onChange('wb_time_in', e.target.value)}
                      className={input}
                    />
                  </Field>
                  <Field title="1st Mass (kg)">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={data.wb_first_mass}
                      onChange={(e) => handleMassChange('wb_first_mass', e.target.value)}
                      placeholder="0.000"
                      className={input}
                    />
                  </Field>
                </div>

                <div className="p-3 rounded-lg bg-orange-50/60 border border-orange-100 space-y-2.5">
                  <p className="text-[10px] font-bold text-orange-800 uppercase tracking-wider">Exit — 2nd Weighing</p>
                  <Field title="Time Out">
                    <input
                      type="datetime-local"
                      value={data.wb_time_out}
                      onChange={(e) => onChange('wb_time_out', e.target.value)}
                      className={input}
                    />
                  </Field>
                  <Field title="2nd Mass (kg)">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={data.wb_second_mass}
                      onChange={(e) => handleMassChange('wb_second_mass', e.target.value)}
                      placeholder="0.000"
                      className={input}
                    />
                  </Field>
                </div>
              </div>

              {/* Nett Mass + Driver Signed */}
              <div className="flex items-stretch gap-2.5">
                <div className="flex-1 p-3 rounded-lg bg-orange-50 border border-orange-200">
                  <label className="block text-[10px] font-bold text-orange-800 uppercase tracking-wider mb-1">
                    Nett Mass (kg) — Auto
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={data.wb_nett_mass}
                    onChange={(e) => onChange('wb_nett_mass', e.target.value)}
                    placeholder="Auto-calculated"
                    className="w-full px-3 py-2 border border-orange-300 rounded-md text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white"
                  />
                </div>

                <div className="flex flex-col items-center justify-center gap-1.5 px-5 rounded-lg border border-slate-200 bg-slate-50 min-w-[120px]">
                  <label className="flex flex-col items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={data.wb_driver_signed}
                      onChange={(e) => onChange('wb_driver_signed', e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-10 h-6 rounded-full transition-colors duration-200 relative ${
                        data.wb_driver_signed ? 'bg-orange-500' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                          data.wb_driver_signed ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                    <span className="text-[10px] font-semibold text-slate-600">Driver Signed</span>
                  </label>
                  {data.wb_driver_signed && (
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-orange-700">
                      <CheckCircle className="w-3 h-3" />
                      Signed
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

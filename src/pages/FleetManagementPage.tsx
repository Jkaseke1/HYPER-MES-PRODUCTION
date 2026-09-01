import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck, Wrench, AlertTriangle, ShieldCheck, Plus, Search, Filter, Eye, Edit2, Play,
  CheckCircle2, Clock, MapPin, Fuel, User, FileText, ArrowRightLeft, DollarSign,
  Building, RefreshCw, X, ChevronRight, Activity, Calendar, ShieldAlert
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/ui/Modal';
import StatCard from '../components/ui/StatCard';
import type { FleetVehicle, FleetAllocation, FleetMaintenanceRecord, FleetBreakdown, FleetHiredTruck } from '../types/database';

/* ── Fallback Initial Fleet Vehicles Data ── */
const INITIAL_VEHICLES: FleetVehicle[] = [
  {
    id: 'veh-1',
    registration_number: 'ABG 1234',
    make_model: 'DAF XF 480 (30 Ton Superlink)',
    vehicle_type: 'horse_trailer',
    ownership: 'owned',
    capacity_tons: 30,
    current_odometer_km: 142500,
    status: 'available',
    assigned_driver_name: 'P. Tembo',
    driver_phone: '+263 77 123 4567',
    fuel_tank_capacity_l: 600,
    avg_fuel_consumption_kml: 2.2,
    service_interval_km: 15000,
    last_service_odometer_km: 135000,
    last_service_date: '2026-06-15',
    next_service_due_km: 150000,
    license_expiry_date: '2026-11-30',
    insurance_expiry_date: '2026-12-31',
    created_at: '2026-01-10T08:00:00Z',
  },
  {
    id: 'veh-2',
    registration_number: 'AES 5678',
    make_model: 'Volvo FH16 (34 Ton Interlink)',
    vehicle_type: 'horse_trailer',
    ownership: 'owned',
    capacity_tons: 34,
    current_odometer_km: 98400,
    status: 'in_transit',
    assigned_driver_name: 'S. Mujele',
    driver_phone: '+263 77 234 5678',
    fuel_tank_capacity_l: 750,
    avg_fuel_consumption_kml: 2.0,
    service_interval_km: 20000,
    last_service_odometer_km: 80000,
    last_service_date: '2026-05-20',
    next_service_due_km: 100000,
    license_expiry_date: '2026-10-15',
    insurance_expiry_date: '2026-11-15',
    created_at: '2026-01-12T08:00:00Z',
  },
  {
    id: 'veh-3',
    registration_number: 'AFG 9012',
    make_model: 'Isuzu FVR 900 (10 Ton Rigid)',
    vehicle_type: 'rigid_truck',
    ownership: 'owned',
    capacity_tons: 10,
    current_odometer_km: 215000,
    status: 'maintenance',
    assigned_driver_name: 'J. Kaseke',
    driver_phone: '+263 77 345 6789',
    fuel_tank_capacity_l: 300,
    avg_fuel_consumption_kml: 3.5,
    service_interval_km: 10000,
    last_service_odometer_km: 205000,
    last_service_date: '2026-07-02',
    next_service_due_km: 215000,
    license_expiry_date: '2026-09-30',
    insurance_expiry_date: '2026-10-31',
    created_at: '2026-01-15T08:00:00Z',
  },
  {
    id: 'veh-4',
    registration_number: 'AHL 3456',
    make_model: 'Scania R500 (30 Ton Tri-Axle)',
    vehicle_type: 'horse_trailer',
    ownership: 'owned',
    capacity_tons: 30,
    current_odometer_km: 67800,
    status: 'breakdown',
    assigned_driver_name: 'M. Moyo',
    driver_phone: '+263 77 456 7890',
    fuel_tank_capacity_l: 600,
    avg_fuel_consumption_kml: 2.3,
    service_interval_km: 15000,
    last_service_odometer_km: 60000,
    last_service_date: '2026-06-01',
    next_service_due_km: 75000,
    license_expiry_date: '2026-12-01',
    insurance_expiry_date: '2026-12-31',
    created_at: '2026-02-01T08:00:00Z',
  },
  {
    id: 'veh-5',
    registration_number: 'AGE 7890',
    make_model: 'Shacman F3000 (30 Ton Hired Freighter)',
    vehicle_type: 'hired_truck',
    ownership: 'hired',
    capacity_tons: 30,
    current_odometer_km: 180000,
    status: 'available',
    assigned_driver_name: 'T. Ndlovu',
    driver_phone: '+263 77 567 8901',
    transporter_vendor_name: 'Swift Transport Logistics',
    hire_rate_per_ton: 28,
    created_at: '2026-03-10T08:00:00Z',
  },
];

/* ── Initial Allocations Data ── */
const INITIAL_ALLOCATIONS: FleetAllocation[] = [
  {
    id: 'alloc-1',
    allocation_number: 'TRK-ALLOC-2026-081',
    vehicle_id: 'veh-2',
    driver_name: 'S. Mujele',
    driver_phone: '+263 77 234 5678',
    allocation_type: 'dispatch_delivery',
    reference_order_number: 'DISP-2026-0042',
    destination: 'Bulawayo Main Branch Hub',
    planned_tonnage: 30,
    start_odometer_km: 98400,
    fuel_issued_liters: 320,
    fuel_cost_usd: 448,
    dispatch_time: '2026-08-03 06:30',
    expected_return_time: '2026-08-03 18:00',
    status: 'in_transit',
    notes: 'Transporting Layer Mash 50kg Bags to Bulawayo Depot.',
    created_at: '2026-08-03T06:30:00Z',
  },
  {
    id: 'alloc-2',
    allocation_number: 'TRK-ALLOC-2026-080',
    vehicle_id: 'veh-1',
    driver_name: 'P. Tembo',
    driver_phone: '+263 77 123 4567',
    allocation_type: 'material_transfer',
    reference_order_number: 'TRF-2026-0115',
    destination: 'Harare Premix Plant 2',
    planned_tonnage: 28,
    start_odometer_km: 142100,
    end_odometer_km: 142500,
    fuel_issued_liters: 90,
    fuel_cost_usd: 126,
    dispatch_time: '2026-08-02 08:00',
    actual_return_time: '2026-08-02 16:30',
    status: 'returned',
    notes: 'Bulk Maize Transfer successfully completed.',
    created_at: '2026-08-02T08:00:00Z',
  },
];

/* ── Initial Maintenance Data ── */
const INITIAL_MAINTENANCE: FleetMaintenanceRecord[] = [
  {
    id: 'maint-1',
    maintenance_number: 'FLT-SVC-2026-014',
    vehicle_id: 'veh-3',
    service_type: 'preventative',
    description: 'Routine 215,000km Major Service (Oil, Filters, Fuel Injector Check)',
    work_done_by: 'Isuzu Zimbabwe Commercial Workshop',
    odometer_reading_km: 215000,
    cost_usd: 650,
    parts_replaced: 'Engine Oil 15W40, Oil Filter, Air Filter, Fuel Filters',
    service_date: '2026-08-03',
    status: 'in_progress',
    notes: 'Vehicle expected back in service by tomorrow morning.',
    created_at: '2026-08-03T07:00:00Z',
  },
  {
    id: 'maint-2',
    maintenance_number: 'FLT-SVC-2026-012',
    vehicle_id: 'veh-1',
    service_type: 'tire_replacement',
    description: 'Replaced 4 Drive Axle Tires & Wheel Alignment',
    work_done_by: 'Trentyre Harare Depot',
    odometer_reading_km: 135000,
    cost_usd: 1800,
    parts_replaced: '4x 315/80 R22.5 Heavy Duty Drive Tires',
    service_date: '2026-06-15',
    completion_date: '2026-06-15',
    status: 'completed',
    created_at: '2026-06-15T10:00:00Z',
  },
];

/* ── Initial Breakdowns Data ── */
const INITIAL_BREAKDOWNS: FleetBreakdown[] = [
  {
    id: 'brk-1',
    incident_number: 'BRK-2026-004',
    vehicle_id: 'veh-4',
    driver_name: 'M. Moyo',
    incident_date_time: '2026-08-03 04:15',
    location: 'Harare-Masvingo Highway (85km peg)',
    nature_of_breakdown: 'tire_blowout',
    description: 'Double rear drive tire blowout caused by road debris. Trailer loaded with 30T Broiler Finisher.',
    cargo_status: 'intact',
    rescue_vehicle_id: 'veh-1',
    downtime_hours: 5,
    repair_cost_usd: 950,
    status: 'mechanic_dispatched',
    notes: 'Mobile tire service team dispatched from Chivhu. Driver safe.',
    created_at: '2026-08-03T04:30:00Z',
  },
];

export default function FleetManagementPage() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'vehicles' | 'allocations' | 'maintenance' | 'breakdowns' | 'hired'>('vehicles');
  const [loading, setLoading] = useState(false);

  // Core Datasets
  // Production starts empty until authorised fleet records are captured.
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [allocations, setAllocations] = useState<FleetAllocation[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<FleetMaintenanceRecord[]>([]);
  const [breakdowns, setBreakdowns] = useState<FleetBreakdown[]>([]);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showBreakdownModal, setShowBreakdownModal] = useState(false);

  // Form States
  const [vehicleForm, setVehicleForm] = useState({
    registration_number: '',
    make_model: '',
    vehicle_type: 'horse_trailer',
    ownership: 'owned',
    capacity_tons: 30,
    current_odometer_km: 100000,
    assigned_driver_name: '',
    driver_phone: '',
    fuel_tank_capacity_l: 600,
    avg_fuel_consumption_kml: 2.2,
    transporter_vendor_name: '',
    hire_rate_per_ton: 0,
  });

  const [allocationForm, setAllocationForm] = useState({
    vehicle_id: '',
    driver_name: '',
    driver_phone: '',
    allocation_type: 'dispatch_delivery',
    reference_order_number: '',
    destination: '',
    planned_tonnage: 30,
    start_odometer_km: 0,
    fuel_issued_liters: 0,
    fuel_cost_usd: 0,
    notes: '',
  });

  const [maintenanceForm, setMaintenanceForm] = useState({
    vehicle_id: '',
    service_type: 'preventative',
    description: '',
    work_done_by: '',
    odometer_reading_km: 0,
    cost_usd: 0,
    parts_replaced: '',
    notes: '',
  });

  const [breakdownForm, setBreakdownForm] = useState({
    vehicle_id: '',
    driver_name: '',
    location: '',
    nature_of_breakdown: 'tire_blowout',
    description: '',
    cargo_status: 'intact',
    rescue_vehicle_id: '',
    notes: '',
  });

  // Fetch Supabase data if available
  useEffect(() => {
    fetchFleetData();
  }, []);

  async function fetchFleetData() {
    setLoading(true);
    try {
      const [vRes, aRes, mRes, bRes] = await Promise.all([
        supabase.from('fleet_vehicles').select('*').order('registration_number'),
        supabase.from('fleet_allocations').select('*, vehicles:fleet_vehicles(registration_number, make_model)').order('created_at', { ascending: false }),
        supabase.from('fleet_maintenance').select('*, vehicles:fleet_vehicles(registration_number, make_model)').order('created_at', { ascending: false }),
        supabase.from('fleet_breakdowns').select('*, vehicles:fleet_vehicles!fleet_breakdowns_vehicle_id_fkey(registration_number, make_model)').order('created_at', { ascending: false }),
      ]);

      if (vRes.data && vRes.data.length > 0) setVehicles(vRes.data);
      if (aRes.data && aRes.data.length > 0) setAllocations(aRes.data);
      if (mRes.data && mRes.data.length > 0) setMaintenanceRecords(mRes.data);
      if (bRes.data && bRes.data.length > 0) setBreakdowns(bRes.data);
    } catch (err) {
      console.warn('Using local fleet state:', err);
    } finally {
      setLoading(false);
    }
  }

  /* ── KPI Stats Calculations ── */
  const totalVehiclesCount = vehicles.length;
  const availableCount = vehicles.filter(v => v.status === 'available').length;
  const activeTripsCount = vehicles.filter(v => v.status === 'in_transit' || v.status === 'allocated').length;
  const inServiceCount = vehicles.filter(v => v.status === 'maintenance').length;
  const breakdownCount = vehicles.filter(v => v.status === 'breakdown').length;

  /* ── Filtered Datasets ── */
  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      const matchesSearch = v.registration_number.toLowerCase().includes(search.toLowerCase()) ||
        v.make_model.toLowerCase().includes(search.toLowerCase()) ||
        (v.assigned_driver_name || '').toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || v.status === statusFilter || v.ownership === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, statusFilter]);

  /* ── Handlers ── */
  async function handleAddVehicle(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleForm.registration_number || !vehicleForm.make_model) {
      toast.error('Please fill in vehicle registration and model details');
      return;
    }

    const vehiclePayload = {
      registration_number: vehicleForm.registration_number.toUpperCase(),
      make_model: vehicleForm.make_model,
      vehicle_type: vehicleForm.vehicle_type as any,
      ownership: vehicleForm.ownership as any,
      capacity_tons: Number(vehicleForm.capacity_tons),
      current_odometer_km: Number(vehicleForm.current_odometer_km),
      status: 'available',
      assigned_driver_name: vehicleForm.assigned_driver_name,
      driver_phone: vehicleForm.driver_phone,
      fuel_tank_capacity_l: Number(vehicleForm.fuel_tank_capacity_l),
      avg_fuel_consumption_kml: Number(vehicleForm.avg_fuel_consumption_kml),
      transporter_vendor_name: vehicleForm.transporter_vendor_name || undefined,
      hire_rate_per_ton: Number(vehicleForm.hire_rate_per_ton) || undefined,
    };

    try {
      const { data, error } = await supabase.from('fleet_vehicles').insert(vehiclePayload).select().single();
      if (error) throw error;
      const newVehicle = data as FleetVehicle;

      setVehicles([newVehicle, ...vehicles]);
      setShowVehicleModal(false);
      toast.success(`Vehicle ${newVehicle.registration_number} registered successfully!`);
      setVehicleForm({
        registration_number: '', make_model: '', vehicle_type: 'horse_trailer', ownership: 'owned',
        capacity_tons: 30, current_odometer_km: 100000, assigned_driver_name: '', driver_phone: '',
        fuel_tank_capacity_l: 600, avg_fuel_consumption_kml: 2.2, transporter_vendor_name: '', hire_rate_per_ton: 0,
      });
    } catch (error: any) {
      toast.error(`Vehicle registration failed: ${error.message}`);
    }
  }

  async function handleCreateAllocation(e: React.FormEvent) {
    e.preventDefault();
    const targetVeh = vehicles.find(v => v.id === allocationForm.vehicle_id);
    if (!targetVeh) {
      toast.error('Please select a truck to allocate');
      return;
    }

    const allocationPayload = {
      allocation_number: `TRK-ALLOC-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      vehicle_id: targetVeh.id,
      driver_name: allocationForm.driver_name || targetVeh.assigned_driver_name || 'Assigned Driver',
      driver_phone: allocationForm.driver_phone || targetVeh.driver_phone || '',
      allocation_type: allocationForm.allocation_type as any,
      reference_order_number: allocationForm.reference_order_number || undefined,
      destination: allocationForm.destination,
      planned_tonnage: Number(allocationForm.planned_tonnage),
      start_odometer_km: Number(allocationForm.start_odometer_km) || targetVeh.current_odometer_km,
      fuel_issued_liters: Number(allocationForm.fuel_issued_liters) || undefined,
      fuel_cost_usd: Number(allocationForm.fuel_cost_usd) || undefined,
      dispatch_time: new Date().toISOString(),
      status: 'in_transit',
      notes: allocationForm.notes,
      created_by: profile?.id || null,
    };

    try {
      const { data, error } = await supabase.from('fleet_allocations').insert(allocationPayload).select().single();
      if (error) throw error;
      const { error: vehicleError } = await supabase.from('fleet_vehicles').update({ status: 'in_transit' }).eq('id', targetVeh.id);
      if (vehicleError) throw vehicleError;
      const newAlloc = { ...data, vehicles: targetVeh } as FleetAllocation;
      setVehicles(prev => prev.map(v => v.id === targetVeh.id ? { ...v, status: 'in_transit' } : v));
      setAllocations([newAlloc, ...allocations]);
      setShowAllocationModal(false);
      toast.success(`Truck ${targetVeh.registration_number} dispatched to ${newAlloc.destination}!`);
    } catch (error: any) {
      toast.error(`Truck allocation failed: ${error.message}`);
    }
  }

  async function handleReportBreakdown(e: React.FormEvent) {
    e.preventDefault();
    const targetVeh = vehicles.find(v => v.id === breakdownForm.vehicle_id);
    if (!targetVeh) {
      toast.error('Please select the breakdown vehicle');
      return;
    }

    const breakdownPayload = {
      incident_number: `BRK-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      vehicle_id: targetVeh.id,
      driver_name: breakdownForm.driver_name || targetVeh.assigned_driver_name || 'Driver',
      incident_date_time: new Date().toISOString(),
      location: breakdownForm.location,
      nature_of_breakdown: breakdownForm.nature_of_breakdown as any,
      description: breakdownForm.description,
      cargo_status: breakdownForm.cargo_status as any,
      rescue_vehicle_id: breakdownForm.rescue_vehicle_id || undefined,
      status: 'reported',
      created_by: profile?.id || null,
    };

    try {
      const { data, error } = await supabase.from('fleet_breakdowns').insert(breakdownPayload).select().single();
      if (error) throw error;
      const { error: vehicleError } = await supabase.from('fleet_vehicles').update({ status: 'breakdown' }).eq('id', targetVeh.id);
      if (vehicleError) throw vehicleError;
      const newBreakdown = { ...data, vehicles: targetVeh } as FleetBreakdown;
      setVehicles(prev => prev.map(v => v.id === targetVeh.id ? { ...v, status: 'breakdown' } : v));
      setBreakdowns([newBreakdown, ...breakdowns]);
      setShowBreakdownModal(false);
      toast.error(`BREAKDOWN ALERT logged for truck ${targetVeh.registration_number}`);
    } catch (error: any) {
      toast.error(`Breakdown report failed: ${error.message}`);
    }
  }

  async function handleLogMaintenance(e: React.FormEvent) {
    e.preventDefault();
    const targetVeh = vehicles.find(v => v.id === maintenanceForm.vehicle_id);
    if (!targetVeh) {
      toast.error('Please select a vehicle');
      return;
    }

    const maintenancePayload = {
      maintenance_number: `FLT-SVC-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
      vehicle_id: targetVeh.id,
      service_type: maintenanceForm.service_type as any,
      description: maintenanceForm.description,
      work_done_by: maintenanceForm.work_done_by,
      odometer_reading_km: Number(maintenanceForm.odometer_reading_km) || targetVeh.current_odometer_km,
      cost_usd: Number(maintenanceForm.cost_usd),
      parts_replaced: maintenanceForm.parts_replaced,
      service_date: format(new Date(), 'yyyy-MM-dd'),
      status: 'in_progress',
      created_by: profile?.id || null,
    };

    try {
      const { data, error } = await supabase.from('fleet_maintenance').insert(maintenancePayload).select().single();
      if (error) throw error;
      const { error: vehicleError } = await supabase.from('fleet_vehicles').update({ status: 'maintenance' }).eq('id', targetVeh.id);
      if (vehicleError) throw vehicleError;
      const newMaint = { ...data, vehicles: targetVeh } as FleetMaintenanceRecord;
      setVehicles(prev => prev.map(v => v.id === targetVeh.id ? { ...v, status: 'maintenance' } : v));
      setMaintenanceRecords([newMaint, ...maintenanceRecords]);
      setShowMaintenanceModal(false);
      toast.success(`Maintenance order logged for ${targetVeh.registration_number}`);
    } catch (error: any) {
      toast.error(`Maintenance logging failed: ${error.message}`);
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Top Page Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 text-white p-6 rounded-3xl shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
              <Truck className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">Logistics & Dispatch Module</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Hyperfeeds Fleet Management</h1>
          <p className="text-xs text-slate-300">
            Real-time fleet operations, truck allocations, maintenance logs, breakdown emergencies, and hired transport.
          </p>
        </div>

        {/* Header Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowAllocationModal(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shadow-md"
          >
            <Play className="w-4 h-4" /> Allocate Truck / Trip
          </button>
          <button
            onClick={() => setShowBreakdownModal(true)}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shadow-md"
          >
            <AlertTriangle className="w-4 h-4" /> Report Breakdown
          </button>
          <button
            onClick={() => setShowMaintenanceModal(true)}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shadow-md"
          >
            <Wrench className="w-4 h-4" /> Log Service
          </button>
          <button
            onClick={() => setShowVehicleModal(true)}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-all shadow-md"
          >
            <Plus className="w-4 h-4" /> Register Vehicle
          </button>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard title="Total Fleet Size" value={totalVehiclesCount} icon={Truck} color="teal" />
        <StatCard title="Available Trucks" value={availableCount} icon={CheckCircle2} color="emerald" />
        <StatCard title="Active In-Transit" value={activeTripsCount} icon={ArrowRightLeft} color="blue" />
        <StatCard title="In Maintenance" value={inServiceCount} icon={Wrench} color="amber" />
        <StatCard title="Breakdowns Alert" value={breakdownCount} icon={AlertTriangle} color="red" />
      </div>

      {/* ── Navigation Tabs & Filters ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {[
            { key: 'vehicles', label: 'Fleet Register', icon: Truck, count: totalVehiclesCount },
            { key: 'allocations', label: 'Truck Allocations & Trips', icon: ArrowRightLeft, count: allocations.length },
            { key: 'maintenance', label: 'Service & Repairs', icon: Wrench, count: maintenanceRecords.length },
            { key: 'breakdowns', label: 'Breakdown Emergency', icon: AlertTriangle, count: breakdowns.length },
            { key: 'hired', label: 'Subcontracted Transporters', icon: Building, count: vehicles.filter(v => v.ownership === 'hired').length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                activeTab === tab.key ? 'bg-teal-500 text-slate-900' : 'bg-slate-200 text-slate-700'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search truck, driver, reg..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          />
        </div>
      </div>

      {/* ── TAB 1: Fleet Register ── */}
      {activeTab === 'vehicles' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVehicles.map(veh => (
              <div key={veh.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 hover:shadow-md transition-shadow relative overflow-hidden">
                {/* Status Indicator Bar */}
                <div className={`absolute top-0 left-0 right-0 h-1.5 ${
                  veh.status === 'available' ? 'bg-emerald-500' :
                  veh.status === 'in_transit' ? 'bg-blue-500' :
                  veh.status === 'maintenance' ? 'bg-amber-500' : 'bg-red-500'
                }`} />

                <div className="flex justify-between items-start pt-1">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                      {veh.ownership === 'hired' ? '3rd Party Hired' : 'Hyperfeeds Fleet'}
                    </span>
                    <h3 className="text-lg font-black text-slate-900 font-mono">{veh.registration_number}</h3>
                    <p className="text-xs font-semibold text-slate-600">{veh.make_model}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${
                    veh.status === 'available' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    veh.status === 'in_transit' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    veh.status === 'maintenance' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'
                  }`}>
                    {veh.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100 font-medium">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Capacity:</span>
                    <span className="font-extrabold text-slate-800">{veh.capacity_tons} Tons</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Current Odometer:</span>
                    <span className="font-extrabold text-slate-800 font-mono">{veh.current_odometer_km.toLocaleString()} km</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Assigned Driver:</span>
                    <span className="font-bold text-teal-800">{veh.assigned_driver_name || 'Unassigned'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Fuel Rate:</span>
                    <span className="font-bold text-slate-800 font-mono">{veh.avg_fuel_consumption_kml || '2.2'} km/L</span>
                  </div>
                </div>

                {veh.next_service_due_km && (
                  <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-100">
                    <span className="text-slate-500 text-[11px]">Next Service Due:</span>
                    <span className="font-mono font-bold text-amber-700">{veh.next_service_due_km.toLocaleString()} km</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 2: Truck Allocations & Trips ── */}
      {activeTab === 'allocations' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-slate-900 text-white px-5 py-4 flex justify-between items-center">
            <span className="font-bold text-xs uppercase tracking-wider text-teal-400">Active & Historical Fleet Allocations</span>
            <span className="text-xs font-mono font-bold">{allocations.length} Trips Registered</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Alloc #</th>
                  <th className="px-4 py-3 text-left">Truck & Driver</th>
                  <th className="px-4 py-3 text-left">Destination</th>
                  <th className="px-4 py-3 text-right">Tonnage</th>
                  <th className="px-4 py-3 text-right">Fuel Issued</th>
                  <th className="px-4 py-3 text-center">Dispatch Time</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                {allocations.map(alloc => (
                  <tr key={alloc.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-teal-800">{alloc.allocation_number}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{alloc.vehicles?.registration_number || 'Truck'}</div>
                      <div className="text-xs text-slate-500">{alloc.driver_name}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-bold">{alloc.destination}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">{alloc.planned_tonnage} T</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700 font-bold">
                      {alloc.fuel_issued_liters ? `${alloc.fuel_issued_liters} L ($${alloc.fuel_cost_usd})` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{alloc.dispatch_time}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        alloc.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                        alloc.status === 'returned' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {alloc.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 3: Service & Maintenance ── */}
      {activeTab === 'maintenance' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-slate-900 text-white px-5 py-4 flex justify-between items-center">
            <span className="font-bold text-xs uppercase tracking-wider text-amber-400">Fleet Maintenance & Repair Logs</span>
            <span className="text-xs font-mono font-bold">{maintenanceRecords.length} Records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Maint #</th>
                  <th className="px-4 py-3 text-left">Truck Reg</th>
                  <th className="px-4 py-3 text-left">Service Description</th>
                  <th className="px-4 py-3 text-left">Workshop / Vendor</th>
                  <th className="px-4 py-3 text-right">Service Cost</th>
                  <th className="px-4 py-3 text-center">Date</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                {maintenanceRecords.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-amber-700">{m.maintenance_number}</td>
                    <td className="px-4 py-3 font-bold font-mono text-slate-900">{m.vehicles?.registration_number}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{m.description}</div>
                      {m.parts_replaced && <div className="text-[11px] text-slate-500">Parts: {m.parts_replaced}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-bold">{m.work_done_by}</td>
                    <td className="px-4 py-3 text-right font-mono font-extrabold text-slate-900">${m.cost_usd?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{m.service_date}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        m.status === 'in_progress' ? 'bg-amber-100 text-amber-800' :
                        m.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {m.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 4: Breakdowns & Incidents ── */}
      {activeTab === 'breakdowns' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {breakdowns.map(brk => (
              <div key={brk.id} className="bg-red-50/40 border-2 border-red-200 rounded-2xl p-5 space-y-3 relative">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold text-red-600 uppercase tracking-widest font-mono">
                      Breakdown Report • {brk.incident_number}
                    </span>
                    <h3 className="text-lg font-black text-slate-900 font-mono">{brk.vehicles?.registration_number}</h3>
                    <p className="text-xs font-bold text-red-700">{brk.nature_of_breakdown.replace('_', ' ').toUpperCase()}</p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-600 text-white uppercase tracking-wider">
                    {brk.status.replace('_', ' ')}
                  </span>
                </div>

                <p className="text-xs text-slate-700 font-medium bg-white p-3 rounded-xl border border-red-100">
                  {brk.description}
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Location:</span>
                    <span className="font-bold text-slate-800">{brk.location}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Driver:</span>
                    <span className="font-bold text-slate-800">{brk.driver_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Cargo Status:</span>
                    <span className="font-bold text-emerald-700 uppercase">{brk.cargo_status}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Downtime / Cost:</span>
                    <span className="font-bold text-slate-900 font-mono">{brk.downtime_hours || 0} hrs / ${brk.repair_cost_usd || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 5: Subcontracted Hired Transport ── */}
      {activeTab === 'hired' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex justify-between items-center border-b pb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900">Subcontracted Transport Partners</h3>
              <p className="text-xs text-slate-500">Manage 3rd-party haulage contractors and hired truck agreements.</p>
            </div>
            <button
              onClick={() => { setVehicleForm({ ...vehicleForm, ownership: 'hired' }); setShowVehicleModal(true); }}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold"
            >
              + Register Hired Truck
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {vehicles.filter(v => v.ownership === 'hired').map(hired => (
              <div key={hired.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-bold text-teal-700 uppercase">{hired.transporter_vendor_name || 'Hired Partner'}</span>
                    <h4 className="text-base font-black text-slate-900 font-mono">{hired.registration_number}</h4>
                    <p className="text-xs text-slate-600">{hired.make_model}</p>
                  </div>
                  <span className="px-2.5 py-1 bg-teal-100 text-teal-800 font-bold text-xs rounded-full">
                    Active Partner
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-white p-3 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Capacity:</span>
                    <span className="font-bold text-slate-800">{hired.capacity_tons} Tons</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Hire Rate:</span>
                    <span className="font-bold text-emerald-700 font-mono">${hired.hire_rate_per_ton || 25} / Ton</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL 1: Register New Vehicle ── */}
      <Modal open={showVehicleModal} onClose={() => setShowVehicleModal(false)} title="Register Fleet Vehicle / Hired Truck">
        <form onSubmit={handleAddVehicle} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Registration Number *</label>
              <input
                type="text"
                required
                placeholder="e.g. ABG 1234"
                value={vehicleForm.registration_number}
                onChange={e => setVehicleForm({ ...vehicleForm, registration_number: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-mono uppercase font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Make & Model *</label>
              <input
                type="text"
                required
                placeholder="e.g. DAF XF 480 30-Ton"
                value={vehicleForm.make_model}
                onChange={e => setVehicleForm({ ...vehicleForm, make_model: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Ownership Type</label>
              <select
                value={vehicleForm.ownership}
                onChange={e => setVehicleForm({ ...vehicleForm, ownership: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-bold"
              >
                <option value="owned">Owned (Hyperfeeds Fleet)</option>
                <option value="hired">Hired (Subcontracted Transporter)</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Capacity (Tons)</label>
              <input
                type="number"
                value={vehicleForm.capacity_tons}
                onChange={e => setVehicleForm({ ...vehicleForm, capacity_tons: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Current Odometer (km)</label>
              <input
                type="number"
                value={vehicleForm.current_odometer_km}
                onChange={e => setVehicleForm({ ...vehicleForm, current_odometer_km: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Assigned Driver Name</label>
              <input
                type="text"
                placeholder="Driver full name"
                value={vehicleForm.assigned_driver_name}
                onChange={e => setVehicleForm({ ...vehicleForm, assigned_driver_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setShowVehicleModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700">
              Save Vehicle
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL 2: Allocate Truck / Trip ── */}
      <Modal open={showAllocationModal} onClose={() => setShowAllocationModal(false)} title="Allocate Truck for Dispatch / Trip">
        <form onSubmit={handleCreateAllocation} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Select Available Truck *</label>
            <select
              required
              value={allocationForm.vehicle_id}
              onChange={e => {
                const veh = vehicles.find(v => v.id === e.target.value);
                setAllocationForm({
                  ...allocationForm,
                  vehicle_id: e.target.value,
                  driver_name: veh?.assigned_driver_name || '',
                  driver_phone: veh?.driver_phone || '',
                  start_odometer_km: veh?.current_odometer_km || 0,
                });
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-bold"
            >
              <option value="">-- Choose Truck --</option>
              {vehicles.filter(v => v.status === 'available').map(v => (
                <option key={v.id} value={v.id}>
                  {v.registration_number} — {v.make_model} ({v.capacity_tons}T)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Destination *</label>
              <input
                type="text"
                required
                placeholder="e.g. Bulawayo Main Depot"
                value={allocationForm.destination}
                onChange={e => setAllocationForm({ ...allocationForm, destination: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tonnage (Tons)</label>
              <input
                type="number"
                value={allocationForm.planned_tonnage}
                onChange={e => setAllocationForm({ ...allocationForm, planned_tonnage: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Driver Name</label>
              <input
                type="text"
                value={allocationForm.driver_name}
                onChange={e => setAllocationForm({ ...allocationForm, driver_name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Fuel Issued (Liters)</label>
              <input
                type="number"
                placeholder="Liters"
                value={allocationForm.fuel_issued_liters}
                onChange={e => setAllocationForm({ ...allocationForm, fuel_issued_liters: Number(e.target.value), fuel_cost_usd: Number(e.target.value) * 1.4 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setShowAllocationModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700">
              Confirm & Dispatch Trip
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL 3: Log Breakdown Emergency ── */}
      <Modal open={showBreakdownModal} onClose={() => setShowBreakdownModal(false)} title="Report Fleet Breakdown Emergency">
        <form onSubmit={handleReportBreakdown} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Breakdown Truck *</label>
            <select
              required
              value={breakdownForm.vehicle_id}
              onChange={e => {
                const veh = vehicles.find(v => v.id === e.target.value);
                setBreakdownForm({ ...breakdownForm, vehicle_id: e.target.value, driver_name: veh?.assigned_driver_name || '' });
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-bold text-red-700"
            >
              <option value="">-- Select Truck --</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.registration_number} — {v.make_model}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Incident Location *</label>
              <input
                type="text"
                required
                placeholder="e.g. Harare-Bulawayo Hwy 45km"
                value={breakdownForm.location}
                onChange={e => setBreakdownForm({ ...breakdownForm, location: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Nature of Breakdown</label>
              <select
                value={breakdownForm.nature_of_breakdown}
                onChange={e => setBreakdownForm({ ...breakdownForm, nature_of_breakdown: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-bold"
              >
                <option value="tire_blowout">Tire Blowout</option>
                <option value="engine_failure">Engine Failure / Overheating</option>
                <option value="brake_system">Brake System Fault</option>
                <option value="gearbox_transmission">Gearbox / Transmission</option>
                <option value="electrical">Electrical System</option>
                <option value="accident">Accident / Collision</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Breakdown Description</label>
            <textarea
              rows={2}
              value={breakdownForm.description}
              onChange={e => setBreakdownForm({ ...breakdownForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Provide details on the cause and status..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setShowBreakdownModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700">
              Submit Breakdown Report
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL 4: Log Maintenance Service ── */}
      <Modal open={showMaintenanceModal} onClose={() => setShowMaintenanceModal(false)} title="Log Vehicle Service & Maintenance">
        <form onSubmit={handleLogMaintenance} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Vehicle *</label>
            <select
              required
              value={maintenanceForm.vehicle_id}
              onChange={e => {
                const veh = vehicles.find(v => v.id === e.target.value);
                setMaintenanceForm({ ...maintenanceForm, vehicle_id: e.target.value, odometer_reading_km: veh?.current_odometer_km || 0 });
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold"
            >
              <option value="">-- Choose Truck --</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.registration_number} — {v.make_model}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Workshop / Mechanic Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. DAF Zimbabwe Workshop"
                value={maintenanceForm.work_done_by}
                onChange={e => setMaintenanceForm({ ...maintenanceForm, work_done_by: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Estimated Cost ($ USD)</label>
              <input
                type="number"
                placeholder="Cost in USD"
                value={maintenanceForm.cost_usd}
                onChange={e => setMaintenanceForm({ ...maintenanceForm, cost_usd: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Service Description</label>
            <textarea
              rows={2}
              value={maintenanceForm.description}
              onChange={e => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="e.g. Major service, oil change, brake pads replacement..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setShowMaintenanceModal(false)} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700">
              Log Maintenance Order
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

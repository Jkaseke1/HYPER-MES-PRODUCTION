import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Phone, Search, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Account = { id:string; legal_name:string; trading_name:string|null; sage_customer_code:string|null; segment:string; primary_phone:string|null };
type Sale = { invoice_date:string; sage_customer_code:string; sales_channel:string; document_count:number; total_sales_amount:number };
type Props<T extends Account> = { customers:T[]; sales:Sale[]; onSelect:(customer:T)=>void };
const money = (value:number) => value.toLocaleString(undefined,{maximumFractionDigits:0});
const dayMs = 86400000;
const shortDate = (value:string) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
const accountName = (account:Account) => account.trading_name || account.legal_name;

export default function CustomerHealthDashboard<T extends Account>({customers,sales,onSelect}:Props<T>) {
  const [period,setPeriod] = useState(30);
  const [filter,setFilter] = useState('watch');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const analysis = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const cutoff = today.getTime() - (period-1)*dayMs;
    const previousCutoff = cutoff-period*dayMs;
    const buckets = new Map<string,{last:string; value:number; prior:number; value90:number; documents:number}>();
    const trend = new Map<string,{date:string; label:string; hq:number; pos:number}>();
    for(let index=0;index<period;index++) {
      const date = new Date(cutoff+index*dayMs);
      const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      trend.set(key,{date:key,label:date.toLocaleDateString(undefined,{day:'numeric',month:'short'}),hq:0,pos:0});
    }
    let hq=0,pos=0,prior=0;
    for(const sale of sales) {
      const timestamp = new Date(`${sale.invoice_date}T00:00:00`).getTime();
      if(timestamp>today.getTime()) continue;
      const value = Number(sale.total_sales_amount);
      const isHq = sale.sales_channel==='hq_invoiced';
      if(timestamp>=cutoff) {
        if(isHq) hq+=value; else pos+=value;
        const point=trend.get(sale.invoice_date);
        if(point) { if(isHq) point.hq+=value; else point.pos+=value; }
      } else if(timestamp>=previousCutoff) prior+=value;
      if(!isHq) continue;
      const code = sale.sage_customer_code.trim().toUpperCase();
      const bucket=buckets.get(code)||{last:sale.invoice_date,value:0,prior:0,value90:0,documents:0};
      if(sale.invoice_date>bucket.last) bucket.last=sale.invoice_date;
      if(timestamp>=cutoff) {bucket.value+=value;bucket.documents+=sale.document_count;}
      else if(timestamp>=previousCutoff) bucket.prior+=value;
      if(timestamp>=today.getTime()-89*dayMs) bucket.value90+=value;
      buckets.set(code,bucket);
    }
    const accounts=customers.flatMap(customer=>{
      const bucket=buckets.get(customer.sage_customer_code?.trim().toUpperCase()||'');
      if(!bucket) return [];
      const days=Math.floor((today.getTime()-new Date(`${bucket.last}T00:00:00`).getTime())/dayMs);
      return [{customer,...bucket,days,health:days<30?'active':days<90?'watch':'dormant'}];
    });
    return {accounts,trend:[...trend.values()],hq,pos,prior,total:hq+pos,latest:sales.reduce((latest,sale)=>sale.invoice_date>latest?sale.invoice_date:latest,''),top:[...accounts].filter(a=>a.value>0).sort((a,b)=>b.value-a.value).slice(0,5)};
  },[customers,sales,period]);
  const filtered=analysis.accounts.filter(a=>(filter==='all'||a.health===filter||(filter==='small_scale'&&a.customer.segment==='small_scale'&&a.health!=='active'))&&[accountName(a.customer),a.customer.sage_customer_code].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>b.value90-a.value90||b.days-a.days);
  const pageCount=Math.max(1,Math.ceil(filtered.length/6));
  const activePage=Math.min(page,pageCount);
  const rows=filtered.slice((activePage-1)*6,activePage*6);
  const change=analysis.prior>0?(analysis.total-analysis.prior)/analysis.prior*100:null;
  const totalAccounts=analysis.accounts.length;
  const resetFilter=(value:string)=>{setFilter(value);setPage(1)};
  if(!sales.length) return <div className="border-y border-slate-200 py-16 text-center text-sm text-slate-500">No purchase history is available yet.</div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-[#0B1F36]">Customer intelligence</h2><p className="mt-1 text-xs text-slate-500">Latest sales: {shortDate(analysis.latest)} · Invoice values incl. VAT · Credits excluded</p></div><div className="flex rounded-md border border-slate-200 bg-white p-1" aria-label="Sales period">{[30,60,90].map(days=><button key={days} aria-pressed={period===days} onClick={()=>setPeriod(days)} className={`rounded px-3 py-1.5 text-xs font-semibold ${period===days?'bg-[#0B1F36] text-white':'text-slate-500 hover:bg-slate-50'}`}>{days} days</button>)}</div></div>
    <section className="grid divide-y divide-slate-200 border-y border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
      <div className="px-5 py-4 sm:border-r sm:border-slate-200"><p className="text-xs font-semibold text-slate-500">Sales · {period} days</p><p className="mt-2 text-2xl font-bold tabular-nums text-[#0B1F36]">{money(analysis.total)}</p><p className={`mt-2 flex items-center gap-1 text-xs ${change!==null&&change<0?'text-rose-600':'text-teal-700'}`}>{change!==null?(<>{change<0?<ArrowDownRight size={14}/>:<ArrowUpRight size={14}/>} {Math.abs(change).toFixed(1)}% vs previous {period} days</>):'No prior-period comparison'}</p></div>
      {([{key:'active',title:'Active accounts',hint:'Purchased within 30 days',tone:'text-teal-700'},{key:'watch',title:'Retention watch',hint:'Last purchase 30–89 days ago',tone:'text-amber-700'},{key:'dormant',title:'Dormant accounts',hint:'Last purchase 90+ days ago',tone:'text-rose-600'}]).map(metric=><button key={metric.key} onClick={()=>resetFilter(metric.key)} className="px-5 py-4 text-left hover:bg-slate-50 sm:border-r sm:border-slate-200 last:border-r-0"><p className="text-xs font-semibold text-slate-500">{metric.title}</p><p className={`mt-2 text-2xl font-bold tabular-nums ${metric.tone}`}>{analysis.accounts.filter(a=>a.health===metric.key).length}</p><p className="mt-2 text-xs text-slate-500">{metric.hint}</p></button>)}
    </section>
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <div className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-[#0B1F36]">Purchase activity</h3><div className="flex gap-4 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal-500"/>HQ invoices</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#0B1F36]"/>Branch POS</span></div></div><div className="mt-4 h-[240px] w-full" aria-label="Daily invoice sales trend"><ResponsiveContainer width="100%" height="100%"><AreaChart data={analysis.trend} margin={{top:8,right:8,left:0,bottom:0}}><CartesianGrid stroke="#e8edf2" vertical={false}/><XAxis dataKey="label" tick={{fontSize:11,fill:'#64748b'}} minTickGap={45} axisLine={false} tickLine={false}/><YAxis width={48} tick={{fontSize:11,fill:'#64748b'}} tickFormatter={value=>`${Math.round(Number(value)/1000)}k`} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>money(Number(value))} contentStyle={{borderRadius:6,borderColor:'#e2e8f0',fontSize:12}}/><Area name="HQ invoices" dataKey="hq" stroke="#0d9488" fill="#14b8a6" fillOpacity={0.12} strokeWidth={2} type="monotone"/><Area name="Branch POS" dataKey="pos" stroke="#0B1F36" fill="#0B1F36" fillOpacity={0.05} strokeWidth={2} type="monotone"/></AreaChart></ResponsiveContainer></div></div>
      <div className="border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><h3 className="text-sm font-bold text-[#0B1F36]">Sales mix</h3><div className="mt-5 space-y-5">{[{title:'HQ invoices',value:analysis.hq,color:'bg-teal-500'},{title:'Branch POS',value:analysis.pos,color:'bg-[#0B1F36]'}].map(channel=><div key={channel.title}><div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">{channel.title}</span><span className="font-semibold tabular-nums text-[#0B1F36]">{money(channel.value)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${channel.color}`} style={{width:`${analysis.total>0?Math.max(0,Math.min(100,channel.value/analysis.total*100)):0}%`}}/></div></div>)}</div><div className="mt-6 border-t border-slate-200 pt-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Users size={14}/>Named accounts with purchase history</div><p className="mt-2 text-xl font-bold text-[#0B1F36]">{totalAccounts}</p><p className="mt-2 text-xs leading-5 text-slate-500">Based on imported HQ invoice history. Branch cash accounts are shown in the sales mix.</p></div></div>
    </section>
    <section className="border-t border-slate-200 pt-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-base font-bold text-[#0B1F36]">Relationship priorities</h3><p className="mt-1 text-xs text-slate-500">{filtered.length} accounts · Ranked by invoice value over 90 days</p></div><div className="flex w-full flex-wrap gap-2 sm:w-auto"><select aria-label="Customer health filter" value={filter} onChange={event=>resetFilter(event.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"><option value="watch">Retention watch</option><option value="dormant">Dormant</option><option value="active">Active</option><option value="small_scale">Small-scale follow-up</option><option value="all">All buying accounts</option></select><label className="relative flex-1 sm:w-56"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400"/><input aria-label="Search buying accounts" value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}} placeholder="Customer or Sage code" className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs"/></label></div></div><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-[11px] text-slate-500"><tr>{['Customer','Last purchase','Days inactive','90-day value','Contact'].map(title=><th key={title} className="px-3 py-3 font-semibold">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row=><tr key={row.customer.id} className="hover:bg-teal-50/40"><td className="min-w-[220px] max-w-[400px] px-3 py-3"><button onClick={()=>onSelect(row.customer)} className="text-left font-semibold text-[#0B1F36] hover:text-teal-700">{accountName(row.customer)}</button><p className="mt-1 text-[11px] text-slate-500">{row.customer.sage_customer_code} · {row.customer.segment.replace(/_/g,' ')}</p></td><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{shortDate(row.last)}</td><td className="px-3 py-3"><span className={`rounded px-2 py-1 text-xs font-semibold ${row.health==='active'?'bg-teal-50 text-teal-700':row.health==='watch'?'bg-amber-50 text-amber-700':'bg-rose-50 text-rose-700'}`}>{row.days} days</span></td><td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums text-[#0B1F36]">{money(row.value90)}</td><td className="px-3 py-3">{row.customer.primary_phone?<a href={`tel:${row.customer.primary_phone.replace(/[^+\d]/g,'')}`} title={`Call ${row.customer.primary_phone}`} className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-teal-700"><Phone size={14}/></a>:<button onClick={()=>onSelect(row.customer)} className="text-xs font-semibold text-teal-700">Open account</button>}</td></tr>)}{!rows.length&&<tr><td colSpan={5} className="py-10 text-center text-sm text-slate-500">No accounts match this filter.</td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-200 py-3 text-xs text-slate-500"><span>Page {activePage} of {pageCount}</span><div className="flex gap-2"><button title="Previous page" aria-label="Previous page" disabled={activePage===1} onClick={()=>setPage(activePage-1)} className="rounded border border-slate-200 p-1.5 disabled:opacity-30"><ChevronLeft size={16}/></button><button title="Next page" aria-label="Next page" disabled={activePage===pageCount} onClick={()=>setPage(activePage+1)} className="rounded border border-slate-200 p-1.5 disabled:opacity-30"><ChevronRight size={16}/></button></div></div></section>
    <section className="border-t border-slate-200 pt-5"><h3 className="text-base font-bold text-[#0B1F36]">Leading customer accounts</h3><p className="mt-1 text-xs text-slate-500">HQ invoice value · Last {period} days</p><div className="mt-4 grid gap-x-8 md:grid-cols-2">{analysis.top.map((row,index)=><button key={row.customer.id} onClick={()=>onSelect(row.customer)} className="flex min-w-0 items-center gap-3 border-b border-slate-100 py-3 text-left"><span className="w-5 shrink-0 text-xs font-semibold text-slate-400">{String(index+1).padStart(2,'0')}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#0B1F36]" title={accountName(row.customer)}>{accountName(row.customer)}</p><div className="mt-2 h-1 rounded-full bg-slate-100"><div className="h-1 rounded-full bg-teal-500" style={{width:`${row.value/(analysis.top[0]?.value||1)*100}%`}}/></div></div><span className="shrink-0 text-sm font-bold tabular-nums text-teal-700">{money(row.value)}</span></button>)}</div></section>
  </div>;
}

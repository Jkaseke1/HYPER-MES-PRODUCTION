import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

const LIVE_TABLES = [
  'weigh_bridge_tickets',
  'goods_received_notes',
  'grn_items',
  'sync_log',
  'material_transfers',
  'production_orders',
  'stock_movements',
  'sage_stock_balances',
  'finished_goods_transfers',
  'dispatches',
];

/** Broadcast core operational changes to open PlantControl pages and users. */
export default function LiveDataUpdates() {
  useEffect(() => {
    let notificationTimer: number | undefined;

    const announceChange = () => {
      window.dispatchEvent(new Event('plantcontrol:data-changed'));
      if (notificationTimer) window.clearTimeout(notificationTimer);
      notificationTimer = window.setTimeout(() => {
        toast.success('Live data updated', {
          id: 'plantcontrol-live-update',
          duration: 2400,
        });
      }, 500);
    };

    const channel = supabase.channel('plantcontrol-live-updates');
    LIVE_TABLES.forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, announceChange);
    });
    channel.subscribe();

    return () => {
      if (notificationTimer) window.clearTimeout(notificationTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}

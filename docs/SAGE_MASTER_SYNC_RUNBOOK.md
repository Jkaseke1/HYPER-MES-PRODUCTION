# Sage Inventory Master Sync

The bridge can pull Sage inventory items into PlantControl without changing Sage transactions.

## Behaviour

- Sage `StkItem.StockLink` becomes both PlantControl `code` and `sage_code`.
- `Description_1` becomes the PlantControl material name.
- `Description_2` becomes the description.
- Missing items are inserted; matching items are updated.
- PlantControl stock balances, reorder levels, costs, and transaction history are preserved.
- Items are never deleted automatically.
- The feature is disabled unless `SAGE_MASTER_SYNC_ENABLED=true`.

## One-time test

From the bridge folder, after confirming the Sage and Supabase credentials:

```powershell
$env:SAGE_MASTER_SYNC_ENABLED = 'true'
node syncMasterData.js
```

The command prints the number of Sage inventory items imported or updated. Verify a sample in PlantControl before enabling the scheduled run.

## Scheduled operation

Set these values in the bridge server `.env`:

```text
SAGE_MASTER_SYNC_ENABLED=true
SAGE_MASTER_SYNC_INTERVAL_MS=86400000
```

Restart the bridge service. The bridge performs one catalogue refresh at startup and then refreshes once per day. The interval cannot be configured below one hour.

## Verification

Search PlantControl Raw Materials for a Sage code such as `PAS00010`. Confirm the name matches Sage and that existing stock and reorder values were not changed.

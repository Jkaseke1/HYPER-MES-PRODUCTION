# Unlisted transporters at receipt

1. At Weighbridge, choose Company-hired transport, then Transporter not listed.
   Enter the legal/trading name, optional phone and note for Finance. Capture the
   provisional record and save the ticket normally. It does not create a Sage
   supplier or financial transaction. Matching active names reuse an existing
   record; concurrent identical captures are serialized to avoid duplicates.
2. Raw Materials can also set/add a company-hired transporter in the GRN capture
   form after selecting a ticket with Company-hired already chosen by Weighbridge,
   before creating the GRN. Raw Materials cannot change the transport option.
   In a pending GRN's details, Raw Materials can also select/add the transporter
   before a freight claim is saved. This supports historical tickets with a
   missing transporter. A saved freight claim locks transporter identity;
   corrections then require Admin review. Existing costing/claim entry remains
   with Raw Materials; Finance receives registration details, not freight costs.
   An unshared new transporter can have its name, phone and Finance note corrected
   on the pending GRN before any freight claim exists. Existing Sage-linked or
   shared transporter masters are not renamed through a receipt.
3. During GRN approval, Finance sees New transporter - Finance action required.
   Finance creates/updates the supplier in Sage using the established process,
   imports the supplier into PlantControl, then finds its exact Sage supplier
   code and confirms the displayed supplier name. Only Finance/Accountant/Admin
   can resolve the registration. MD and Finance Viewer cannot resolve it.
4. Both UI and a database trigger block approval while the new registration is
   pending. After the link is verified, normal VAT review and approval proceed.
   Old transporters default to legacy; previous approved GRNs are not reposted
   or changed. Registration capture and resolution retain actor/time audit JSON.

## Deployment

The single-transaction release script docs/sql/grn-transport-setup.sql includes
all three migrations below in order. Apply either that script or the individual
migrations, not both as separate deployment steps. It does not include the
material-transfer batch-creation migration or modify historical records.

Apply 20261019160000_add_pending_transporter_registration.sql to a staging copy
first, then Production during an agreed quiet window after verifying backups.
Also apply 20261019170000_guard_grn_transport_detail_edits.sql before deploying
the frontend. It locks costing after GRN approval or freight submission and
records before/after cost-detail changes in the existing claim history.
Raw Materials may edit rate, currency, invoice, waybill and notes while the GRN
is pending and its freight claim is draft/rejected; transporter identity is
locked once the GRN exists. No approval or payment permission is added.
Apply 20261019180000_complete_pending_grn_transporter.sql after the above two
migrations. It enables the pending GRN transporter selector, preserves the gate
transport option, and audits replacement IDs with the actor and timestamp.
Deploy the frontend only after all three migrations. The approval UI deliberately
blocks approval if its registration check cannot load. No SDK/server rebuild is
required. This feature does not automatically create suppliers in Sage.

Staging checks: capture from both screens; reuse same-name pending captures;
claim costing with a provisional transporter; deny direct GRN approval while
pending; resolve with a real imported test supplier; allow normal approval only
after VAT review; deny MD/viewer resolution; reject an already-mapped supplier
instead of silently merging accounts; reject transporter replacement after GRN
claim creation or approval; allow replacement on a pending GRN with no claim;
check existing legacy deliveries still approve normally. Verify contact
and name data survive reload and registration audit records are retained.

Local tests cover UI role visibility, approval-state classification and SQL
structure only. The database migration has not been integration-tested here.

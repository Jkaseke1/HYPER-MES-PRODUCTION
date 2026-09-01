# HYPER MES - Sage Pastel Bridge

## 🎯 **Overview**
This bridge connects the HYPER MES system with Sage Pastel accounting software, enabling automatic synchronization of transactions between the two systems.

## 📋 **Priority Implementation Status**

### ✅ **Priority 1: Auto Event Handlers (COMPLETE)**
- **goodsReceiptAuto.js** - Handles GRN confirmations → Sage GRVs through the protected Sage SDK API
- **goodsIssueAuto.js** - Handles material issuance → Sage inventory issues  
- **batchCompleteAuto.js** - Handles production completion → Sage finished goods receipts
- **dispatchAuto.js** - Handles dispatch deliveries → Sage customer invoices
- **materialTransferSdkAuto.js** - Handles received RM → Production warehouse transfers through the protected Sage SDK API

### ✅ **Priority 3: Bridge Worker (COMPLETE)**
- **bridgeWorker.js** - Main worker that polls `sync_log` every 5 seconds by default
- Coordinates all event handlers
- Handles retries and error management
- Provides statistics and health monitoring

## 🚀 **Quick Start**

### 1. Install Dependencies
```bash
cd bridge
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your Supabase and Sage credentials
```

### 3. Test Connection
```bash
npm run test-connection
```

### 4. Start Bridge Worker
```bash
npm start
```

### 5. Start the Local Sage SDK API
From the repository root:

```powershell
.\sage-sdk-api\Build-SageSdkApi.ps1
.\sage-sdk-api\Start-SageSdkApi.ps1
```

## 📊 **Event Flow**

### **Event 1: GRN Confirmation**
1. MES: GRN status changed to 'approved'
2. Trigger: Creates sync_log entry
3. Bridge: Reads goods_received_notes + grn_items
4. Sage SDK API: Posts Sage GRV with Sage `HFGRV######` numbering

### **Event 2: Material Issuance**  
1. MES: production_order_materials.issued = true
2. Trigger: Creates sync_log entry
3. Bridge: Reads material issue data
4. Sage: Posts inventory issue/cost of goods sold

### **Event 3: Production Completion**
1. MES: production_orders.status = 'completed'
2. Trigger: Creates sync_log entry  
3. Bridge: Reads production_orders + production_outputs
4. Sage: Posts finished goods receipt

### **Event 4: Dispatch Delivery**
1. MES: dispatch_orders.status = 'delivered'
2. Trigger: Creates sync_log entry
3. Bridge: Reads dispatch_orders + dispatch_items
4. Sage: Posts customer invoice

### **Event 5: Material Transfer to Production**
1. MES: material_transfers.status = 'received'
2. Trigger: Creates sync_log entry with event_type `material_transfer_to_production`
3. Bridge: Reads material_transfers + raw_materials.sage_code
4. Sage SDK API: Posts warehouse transfer RM → PD with `confirmPost: true`

## 🔧 **Configuration**

### **Environment Variables**
```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Sage Pastel
SAGE_PATH=C:\Pastel\Partner\Partner.exe
SAGE_COMPANY=HYPER FEEDS
SAGE_DATABASE=C:\Pastel\Data\HYPER
SAGE_USERNAME=Manager
SAGE_PASSWORD=

# Bridge Settings
# Optional. Defaults to 5000 ms and is never allowed below 2000 ms.
BRIDGE_POLL_INTERVAL_MS=5000
BATCH_SIZE=10
MAX_RETRIES=3

# Sage SDK API for GRVs and warehouse transfers
SAGE_SDK_API_BASE_URL=http://127.0.0.1:5088
SAGE_SDK_API_KEY=your-protected-sdk-api-key
```

### Phased rollout event scope

Set `BRIDGE_ALLOWED_EVENT_TYPES=grn_confirmed` on the hosted bridge when only
the GRN phase is approved. The worker then ignores pending production,
material-transfer, and dispatch events until their event types are deliberately
added to the allow-list. Leave it blank only once every Sage workflow is live.

### **Required Sage Codes**
- **suppliers.sage_code** - Sage supplier account codes
- **raw_materials.sage_code** - Sage stock item codes  
- **formulations.sage_code** - Sage finished goods codes
- **branches.sage_code** - Sage customer account codes

## 🖥️ **Windows Task Scheduler Setup**

### **Create Bridge Worker Service**
```cmd
# Open Task Scheduler
# Create new task with these settings:
# Trigger: At system startup, repeat every 5 minutes
# Action: Start program
# Program: C:\Program Files\nodejs\node.exe
# Arguments: "C:\Users\Joseph Kaseke\CascadeProjects\HYPER MES\bridge\bridgeWorker.js"
# Start in: C:\Users\Joseph Kaseke\CascadeProjects\HYPER MES\bridge\
# Run with highest privileges
# Configure for: Windows 10, Windows Server 2016
```

### **Create Sage SDK API Service**
```powershell
$taskName = "HYPER MES Sage SDK API"
$apiExe = "C:\Users\Joseph Kaseke\CascadeProjects\HYPER MES\sage-sdk-api\HyperMes.SageSdkApi\bin\Debug\HyperMes.SageSdkApi.exe"
$apiDir = "C:\Users\Joseph Kaseke\CascadeProjects\HYPER MES\sage-sdk-api\HyperMes.SageSdkApi\bin\Debug"

$action = New-ScheduledTaskAction `
  -Execute $apiExe `
  -WorkingDirectory $apiDir

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs the local HYPER MES Sage SDK API on 127.0.0.1:5088." `
  -RunLevel Highest `
  -Force
```

### **Nightly Reconciliation Job**
```cmd
# Create nightly task:
# Trigger: Daily at 2:00 AM
# Action: Run reconciliation script
# Program: C:\Program Files\nodejs\node.exe  
# Arguments: "C:\path\to\bridge\nightlyReconciliation.js"
```

## 📈 **Monitoring**

### **Sync Log Monitoring**
```sql
-- Check pending events
SELECT * FROM sync_log WHERE status = 'pending' ORDER BY created_at;

-- Check failed events  
SELECT * FROM sync_log WHERE status = 'failed' ORDER BY created_at DESC;

-- Event statistics
SELECT event_type, status, COUNT(*) as count 
FROM sync_log 
GROUP BY event_type, status 
ORDER BY event_type, status;
```

### **Bridge Worker Statistics**
The worker outputs real-time statistics:
- Uptime and processing counts
- Success/error rates  
- Queue status by event type
- Retry counts

## 🚨 **Troubleshooting**

### **Common Issues**

**Sage Connection Failed**
- Check Sage Pastel is installed and running
- Verify database path and company name
- Ensure user has proper permissions

**Missing Sage Codes**
```sql
-- Find suppliers without sage_code
SELECT name FROM suppliers WHERE sage_code IS NULL OR sage_code = '';

-- Find materials without sage_code  
SELECT name FROM raw_materials WHERE sage_code IS NULL OR sage_code = '';
```

**Events Not Processing**
- Check sync_log for error details
- Verify triggers are firing in MES
- Check bridge worker logs

### **Manual Event Processing**
```bash
# Process specific event types manually
npm run test-grn      # Process GRN events
npm run test-issue    # Process material issue events  
npm run test-batch    # Process batch completion events
npm run test-dispatch # Process dispatch events
npm run test-material-transfer-sdk -- <material_transfer_id>
```

## 🔄 **Development**

### **Running in Development**
```bash
# Install nodemon for auto-restart
npm install -D nodemon

# Run with auto-restart
npm run dev
```

### **Testing**
```bash
# Run all tests
npm test

# Test specific components
npm run test-connection
```

### **Logging**
Logs are written to `logs/bridge.log` with:
- Event processing details
- Sage transaction responses
- Error details and stack traces
- Performance metrics

## 📋 **Priority 2: MES UI Pages (Next Steps)**

The following MES pages still need to be built:

1. **Reconciliation Report Page** - Shows recon_raw_materials variance data
2. **Purchase Orders List** - Shows purchase_orders table for Mano  
3. **Sync Log Viewer** - Shows sync_log for Joseph monitoring

## 🚀 **Priority 4: Go Live Checklist**

- [ ] Change `.env` to production Sage server
- [ ] Set `NODE_ENV=production`
- [ ] Set up Windows Task Scheduler
- [ ] Test with real Sage data
- [ ] Monitor sync_log for 2 weeks
- [ ] Set up nightly reconciliation jobs

## 📞 **Support**

For issues:
1. Check bridge worker logs
2. Review sync_log table in Supabase
3. Verify Sage Pastel connection
4. Check required sage_code fields

## 🎊 **Status: READY FOR TESTING**

The Priority 1 auto event handlers and bridge worker are complete and ready for testing with real MES data!

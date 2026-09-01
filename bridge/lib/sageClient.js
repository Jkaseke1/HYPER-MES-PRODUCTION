// sageClient.js - Sage Pastel API client
// Handles communication with Sage Pastel accounting system

const winax = require('winax'); // Windows COM automation for Sage Pastel
const fs = require('fs');
const path = require('path');

class SageClient {
  constructor() {
    this.application = null;
    this.company = null;
    this.isConnected = false;
    this.config = {
      sagePath: process.env.SAGE_PATH || 'C:\\Pastel\\Partner\\Partner.exe',
      companyName: process.env.SAGE_COMPANY || 'HYPER FEEDS',
      databasePath: process.env.SAGE_DATABASE || 'C:\\Pastel\\Data\\HYPER',
      username: process.env.SAGE_USERNAME || 'Manager',
      password: process.env.SAGE_PASSWORD || ''
    };
  }

  // Connect to Sage Pastel
  async connect() {
    try {
      console.log('🔗 Connecting to Sage Pastel...');
      
      // Initialize COM object
      this.application = new winax.Object('Pastel.Partner');
      
      // Open company
      this.company = this.application.OpenCompany(
        this.config.databasePath,
        this.config.companyName,
        this.config.username,
        this.config.password
      );
      
      this.isConnected = true;
      console.log(`✅ Connected to Sage Pastel - Company: ${this.config.companyName}`);
      
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Sage Pastel:', error);
      this.isConnected = false;
      throw new Error(`Sage connection failed: ${error.message}`);
    }
  }

  // Disconnect from Sage Pastel
  async disconnect() {
    try {
      if (this.company) {
        this.company.Close();
        this.company = null;
      }
      
      if (this.application) {
        this.application.Quit();
        this.application = null;
      }
      
      this.isConnected = false;
      console.log('✅ Disconnected from Sage Pastel');
    } catch (error) {
      console.error('⚠️  Error disconnecting from Sage:', error);
    }
  }

  // Post supplier invoice (GRN)
  async postSupplierInvoice(transaction) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      console.log(`📝 Posting supplier invoice: ${transaction.reference}`);
      
      // Create supplier invoice in Sage
      const invoice = this.company.CreateSupplierInvoice();
      
      // Set header information
      invoice.SupplierCode = transaction.supplierCode;
      invoice.InvoiceNumber = transaction.reference;
      invoice.InvoiceDate = new Date(transaction.transactionDate);
      invoice.Description = transaction.notes;
      
      // Add line items
      for (const line of transaction.lines) {
        const invoiceLine = invoice.Lines.Add();
        invoiceLine.StockCode = line.stockCode;
        invoiceLine.Description = line.description;
        invoiceLine.Quantity = line.quantity;
        invoiceLine.UnitPrice = line.unitPrice;
        invoiceLine.BatchNumber = line.batchNumber || '';
        
        // Set expiry date if provided
        if (line.expiryDate) {
          invoiceLine.ExpiryDate = new Date(line.expiryDate);
        }
      }
      
      // Process the invoice
      const result = invoice.Process();
      
      console.log(`✅ Supplier invoice posted successfully: ${transaction.reference}`);
      
      return {
        success: true,
        reference: transaction.reference,
        sageInvoiceNumber: invoice.InvoiceNumber,
        totalAmount: transaction.totalAmount,
        postedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error posting supplier invoice ${transaction.reference}:`, error);
      throw new Error(`Sage supplier invoice failed: ${error.message}`);
    }
  }

  // Post material issue (inventory consumption)
  async postMaterialIssue(transaction) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      console.log(`📝 Posting material issue: ${transaction.reference}`);
      
      // Create inventory adjustment in Sage
      const adjustment = this.company.CreateInventoryAdjustment();
      
      // Set header information
      adjustment.Reference = transaction.reference;
      adjustment.AdjustmentDate = new Date(transaction.transactionDate);
      adjustment.Description = transaction.notes;
      adjustment.AdjustmentType = 'Issue'; // Material consumption
      
      // Add line items
      for (const line of transaction.lines) {
        const adjLine = adjustment.Lines.Add();
        adjLine.StockCode = line.stockCode;
        adjLine.Description = line.description;
        adjLine.Quantity = -Math.abs(line.quantity); // Negative for issue
        adjLine.UnitCost = line.unitCost;
        adjLine.CostCenter = transaction.costCenter;
        adjLine.BatchNumber = line.batchNumber || '';
      }
      
      // Process the adjustment
      const result = adjustment.Process();
      
      console.log(`✅ Material issue posted successfully: ${transaction.reference}`);
      
      return {
        success: true,
        reference: transaction.reference,
        sageAdjustmentNumber: adjustment.AdjustmentNumber,
        totalCost: transaction.lines.reduce((sum, line) => sum + line.totalCost, 0),
        postedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error posting material issue ${transaction.reference}:`, error);
      throw new Error(`Sage material issue failed: ${error.message}`);
    }
  }

  // Post finished goods receipt (production completion)
  async postFinishedGoodsReceipt(transaction) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      console.log(`📝 Posting finished goods receipt: ${transaction.reference}`);
      
      // Create inventory receipt in Sage
      const receipt = this.company.CreateInventoryReceipt();
      
      // Set header information
      receipt.Reference = transaction.reference;
      receipt.ReceiptDate = new Date(transaction.transactionDate);
      receipt.Description = transaction.notes;
      receipt.Warehouse = transaction.warehouse;
      
      // Add line items
      for (const line of transaction.lines) {
        const receiptLine = receipt.Lines.Add();
        receiptLine.StockCode = line.stockCode;
        receiptLine.Description = line.description;
        receiptLine.Quantity = line.quantity;
        receiptLine.UnitCost = transaction.costs?.costPerUnit || 0;
        receiptLine.BatchNumber = line.batchNumber;
        receiptLine.Warehouse = line.warehouse;
        receiptLine.QualityStatus = line.qualityStatus || 'Pending';
      }
      
      // Set cost information
      if (transaction.costs) {
        receipt.TotalCost = transaction.costs.totalCost;
        receipt.RawMaterialCost = transaction.costs.rawMaterialCost;
        receipt.LabourCost = transaction.costs.labourCost;
        receipt.OverheadCost = transaction.costs.overheadCost;
      }
      
      // Process the receipt
      const result = receipt.Process();
      
      console.log(`✅ Finished goods receipt posted successfully: ${transaction.reference}`);
      
      return {
        success: true,
        reference: transaction.reference,
        sageReceiptNumber: receipt.ReceiptNumber,
        totalQuantity: transaction.totalQuantity,
        totalCost: transaction.costs?.totalCost || 0,
        postedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error posting finished goods receipt ${transaction.reference}:`, error);
      throw new Error(`Sage finished goods receipt failed: ${error.message}`);
    }
  }

  // Post customer invoice (dispatch delivery)
  async postCustomerInvoice(transaction) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      console.log(`📝 Posting customer invoice: ${transaction.reference}`);
      
      // Create customer invoice in Sage
      const invoice = this.company.CreateCustomerInvoice();
      
      // Set header information
      invoice.CustomerCode = transaction.customer.code;
      invoice.InvoiceNumber = transaction.reference;
      invoice.InvoiceDate = new Date(transaction.transactionDate);
      invoice.Description = transaction.notes;
      
      // Set customer details
      if (transaction.customer.address) {
        invoice.CustomerAddress = transaction.customer.address;
      }
      
      // Add line items
      for (const line of transaction.lines) {
        const invoiceLine = invoice.Lines.Add();
        invoiceLine.StockCode = line.stockCode;
        invoiceLine.Description = line.description;
        invoiceLine.Quantity = line.quantity;
        invoiceLine.UnitPrice = line.unitPrice;
        invoiceLine.BatchNumber = line.batchNumber || '';
      }
      
      // Set delivery information
      if (transaction.vehicle) {
        invoice.VehicleNumber = transaction.vehicle;
      }
      if (transaction.driver) {
        invoice.DriverName = transaction.driver;
      }
      
      // Process the invoice
      const result = invoice.Process();
      
      console.log(`✅ Customer invoice posted successfully: ${transaction.reference}`);
      
      return {
        success: true,
        reference: transaction.reference,
        sageInvoiceNumber: invoice.InvoiceNumber,
        totalAmount: transaction.totalAmount,
        customerCode: transaction.customer.code,
        postedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error posting customer invoice ${transaction.reference}:`, error);
      throw new Error(`Sage customer invoice failed: ${error.message}`);
    }
  }

  // Test connection and basic operations
  async testConnection() {
    try {
      await this.connect();
      
      // Get company info
      const companyInfo = {
        name: this.company.Name,
        taxYear: this.company.TaxYear,
        period: this.company.Period,
        currency: this.company.Currency
      };
      
      console.log('✅ Sage connection test successful:', companyInfo);
      
      return {
        success: true,
        companyInfo,
        connectedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Sage connection test failed:', error);
      return {
        success: false,
        error: error.message,
        testedAt: new Date().toISOString()
      };
    }
  }

  // Get stock balance for reconciliation
  async getStockBalance(stockCode) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const stock = this.company.GetStockItem(stockCode);
      const balance = stock.Balance;
      
      return {
        stockCode,
        balance,
        unit: stock.Unit,
        lastUpdated: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error getting stock balance for ${stockCode}:`, error);
      throw new Error(`Failed to get stock balance: ${error.message}`);
    }
  }
}

// Create singleton instance
const sageClient = new SageClient();

// Graceful cleanup
process.on('SIGINT', async () => {
  console.log('📡 Closing Sage connection...');
  await sageClient.disconnect();
});

process.on('SIGTERM', async () => {
  console.log('📡 Closing Sage connection...');
  await sageClient.disconnect();
});

module.exports = sageClient;

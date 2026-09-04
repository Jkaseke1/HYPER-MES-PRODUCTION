using System;

namespace SDK_Test
{
    public class GoodsReceiptRequest
    {
        public string Reference { get; set; }
        public string SupplierCode { get; set; }
        public string SupplierName { get; set; }
        public string SupplierInvoiceNo { get; set; }
        public string SupplierDeliveryNoteNo { get; set; }
        public string SupplierOrderNo { get; set; }
        public string ExternalReference { get; set; }
        public string Warehouse { get; set; }
        public DateTime ReceivedDate { get; set; }
        public GoodsReceiptLineRequest[] Lines { get; set; }
        public bool ConfirmPost { get; set; }
    }

    public class GoodsReceiptLineRequest
    {
        public string ItemCode { get; set; }
        public string Description { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitCost { get; set; }
        public string Warehouse { get; set; }
        public string LotNumber { get; set; }
    }
}

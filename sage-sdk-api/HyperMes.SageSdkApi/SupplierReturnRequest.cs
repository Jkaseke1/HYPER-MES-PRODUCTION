using System;

namespace SDK_Test
{
    public class SupplierReturnRequest
    {
        public string Reference { get; set; }
        public string OriginalGrvNumber { get; set; }
        public string SupplierCode { get; set; }
        public string SupplierName { get; set; }
        public DateTime ReturnDate { get; set; }
        public string Reason { get; set; }
        public SupplierReturnLineRequest[] Lines { get; set; }
        public bool ConfirmPost { get; set; }
    }

    public class SupplierReturnLineRequest
    {
        public string ItemCode { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitCost { get; set; }
        public string Warehouse { get; set; }
    }
}

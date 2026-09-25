using System;

namespace SDK_Test
{
    public class ReturnToSupplierValidationRequest
    {
        public string ReturnReference { get; set; }
        public string SupplierCode { get; set; }
        public int SupplierAccountID { get; set; }
        public string OriginalGrnReference { get; set; }
        public string OriginalSageGrvNumber { get; set; }
        public string Reason { get; set; }
        public DateTime? TransactionDate { get; set; }
        public ReturnToSupplierLineRequest[] Lines { get; set; }
        public bool ConfirmPost { get; set; }
    }

    public class ReturnToSupplierLineRequest
    {
        public string ItemCode { get; set; }
        public string WarehouseCode { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitCost { get; set; }
    }
}

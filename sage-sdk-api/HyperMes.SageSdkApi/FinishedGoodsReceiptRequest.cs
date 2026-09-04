using System;

namespace SDK_Test
{
    public class FinishedGoodsReceiptRequest
    {
        public string Reference { get; set; }
        public string Reference2 { get; set; }
        public string ItemCode { get; set; }
        public string Description { get; set; }
        public string Warehouse { get; set; }
        public string TransactionCode { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitCost { get; set; }
        public DateTime ReceiptDate { get; set; }
        public bool ConfirmPost { get; set; }
    }
}

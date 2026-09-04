using System;

namespace SDK_Test
{
    public class ManufacturingProcessRequest
    {
        public string ProcessReference { get; set; }
        public string ExternalReference { get; set; }
        public string FinishedGoodCode { get; set; }
        public decimal Quantity { get; set; }
        public int WarehouseId { get; set; }
        public decimal UnitCost { get; set; }
        public DateTime TransactionDate { get; set; }
        public string Description { get; set; }
        public ManufacturingProcessComponent[] Components { get; set; }
        public bool ConfirmPost { get; set; }
    }

    public class ManufacturingProcessComponent
    {
        public string SageCode { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitCost { get; set; }
        public int WarehouseId { get; set; }
        public string Description { get; set; }
    }
}

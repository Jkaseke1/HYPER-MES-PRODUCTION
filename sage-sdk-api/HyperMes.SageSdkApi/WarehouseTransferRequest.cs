namespace SDK_Test
{
    public class WarehouseTransferRequest
    {
        public string ItemCode { get; set; }
        public string FromWarehouse { get; set; }
        public string ToWarehouse { get; set; }
        public decimal Quantity { get; set; }
        public string Reference { get; set; }
        public string Reference2 { get; set; }
        public bool ConfirmPost { get; set; }
    }
}
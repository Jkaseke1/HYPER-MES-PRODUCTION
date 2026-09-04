using System;

namespace SDK_Test
{
    public class MaterialIssueRequest
    {
        public string Reference { get; set; }
        public string Reference2 { get; set; }
        public string Warehouse { get; set; }
        public string TransactionCode { get; set; }
        public DateTime IssueDate { get; set; }
        public MaterialIssueLineRequest[] Lines { get; set; }
        public bool ConfirmPost { get; set; }
    }

    public class MaterialIssueLineRequest
    {
        public string ItemCode { get; set; }
        public string Description { get; set; }
        public decimal Quantity { get; set; }
    }
}

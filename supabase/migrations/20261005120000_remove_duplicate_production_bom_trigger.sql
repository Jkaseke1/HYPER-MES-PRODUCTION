-- Keep one authoritative production-order BOM loader.
-- The older quantity-based trigger and the newer percentage-based trigger can
-- otherwise both fire for the same production order and duplicate materials.

DROP TRIGGER IF EXISTS trg_populate_production_order_bom
ON public.production_orders;

DROP TRIGGER IF EXISTS on_production_order_created
ON public.production_orders;

CREATE TRIGGER on_production_order_created
AFTER INSERT ON public.production_orders
FOR EACH ROW
EXECUTE FUNCTION public.auto_load_bom_ingredients();

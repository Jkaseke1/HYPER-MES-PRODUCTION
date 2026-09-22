-- Packaging stock is counted as discrete units, not kilograms.
-- This preserves quantities and prices while correcting the master-data unit.
CREATE OR REPLACE FUNCTION public.normalize_packaging_unit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(coalesce(NEW.name, '')) LIKE '%packaging%'
     OR upper(coalesce(NEW.code, '')) LIKE 'PA%' THEN
    NEW.unit := 'units';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_packaging_unit_on_raw_materials ON public.raw_materials;
CREATE TRIGGER normalize_packaging_unit_on_raw_materials
BEFORE INSERT OR UPDATE OF name, code, unit ON public.raw_materials
FOR EACH ROW
EXECUTE FUNCTION public.normalize_packaging_unit();

UPDATE public.raw_materials
SET unit = 'units', updated_at = now()
WHERE (lower(coalesce(name, '')) LIKE '%packaging%'
    OR upper(coalesce(code, '')) LIKE 'PA%')
  AND lower(coalesce(unit, '')) <> 'units';

-- Ensure the Sage identifier is explicit so stock sync and future integrations
-- always target the Chicken Carcass Meal item in Sage.
UPDATE public.raw_materials
SET sage_code = 'CCM0001',
    updated_at = now()
WHERE code = 'CCM0001';

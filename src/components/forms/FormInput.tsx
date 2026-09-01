import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface FormInputProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: number;
  max?: number;
  step?: string;
}

export function FormInput({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
  disabled,
  className,
  min,
  max,
  step,
}: FormInputProps) {
  return (
    <div className="space-y-2">
      <Label>
        {label} {required && <span className="text-red-600">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

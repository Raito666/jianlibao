import NumberField from './NumberField';

export default function NumericStepper({
  label,
  value,
  onChange,
  onStep,
  min = 0,
  max = 1000,
  step = 'any',
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onStep: (direction: 1 | -1) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  disabled?: boolean;
}) {
  return (
    <div className="numeric-stepper">
      <button
        type="button"
        aria-label={`减少${label}`}
        disabled={disabled || value <= min}
        onClick={(event) => {
          if (event.currentTarget.parentElement?.querySelector('input')?.reportValidity()) onStep(-1);
        }}
      >
        −
      </button>
      <NumberField
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={onChange}
      />
      <button
        type="button"
        aria-label={`增加${label}`}
        disabled={disabled || value >= max}
        onClick={(event) => {
          if (event.currentTarget.parentElement?.querySelector('input')?.reportValidity()) onStep(1);
        }}
      >
        +
      </button>
    </div>
  );
}

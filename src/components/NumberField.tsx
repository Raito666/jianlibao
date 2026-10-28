import { useEffect, useRef, useState } from 'react';
import { fadeValue } from '../motion/presentation';
export default function NumberField({
  value,
  onChange,
  label,
  min = 0,
  max = 1000,
  step = 'any',
  disabled = false,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState(String(value));
  const focused = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const previousValue = useRef(value);
  useEffect(() => {
    const changed = previousValue.current !== value;
    previousValue.current = value;
    if (!focused.current) {
      setRaw(String(value));
      if (changed && input.current) return fadeValue(input.current);
    }
  }, [value]);
  return (
    <input
      ref={input}
      className="number-input"
      aria-label={label}
      type="number"
      inputMode={step === 1 ? 'numeric' : 'decimal'}
      enterKeyHint="next"
      required
      min={min}
      max={max}
      step={step}
      value={raw}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        const text = e.currentTarget.value;
        setRaw(text);
        if (text !== '' && e.currentTarget.validity.valid && Number.isFinite(Number(text))) onChange(Number(text));
      }}
    />
  );
}

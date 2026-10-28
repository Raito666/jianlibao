export default function RpeSelect({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value?: number;
  onChange: (value: number | undefined) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="rpe-select"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
    >
      <option value="">未记录</option>
      {Array.from({ length: 9 }, (_, i) => 6 + i / 2).map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </select>
  );
}

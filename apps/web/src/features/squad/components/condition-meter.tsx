type ConditionMeterProps = {
  value: number;
  label: string;
};

function getConditionTone(value: number) {
  if (value >= 80) {
    return 'success';
  }

  if (value >= 65) {
    return 'warning';
  }

  return 'danger';
}

export function ConditionMeter({ value, label }: ConditionMeterProps) {
  const safeValue = Math.min(Math.max(value, 0), 100);
  const tone = getConditionTone(safeValue);

  return (
    <div
      className={`squad-condition-meter squad-condition-meter--${tone}`}
      role="meter"
      aria-label={`${label}: ${safeValue}%`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
    >
      <div className="squad-condition-meter__track" aria-hidden="true">
        <span className="squad-condition-meter__fill" style={{ width: `${safeValue}%` }} />
      </div>
      <span>{safeValue}%</span>
    </div>
  );
}

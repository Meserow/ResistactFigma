/**
 * Tone slider — 0-3 range with the value rendered inside the draggable thumb.
 * The native input thumb is hidden via .tone-slider class (in theme.css);
 * the visible thumb is an absolutely-positioned div whose `left` is computed
 * from the value. The container reserves padding on both sides so the thumb
 * stays inside the visible track at the extremes (V=0 and V=max).
 */
interface ToneRangeSliderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Show "—" instead of the number (used by the EditCard auto/set toggle). */
  unset?: boolean;
  disabled?: boolean;
}

export function ToneRangeSlider({
  value,
  onChange,
  min = 0,
  max = 3,
  step = 1,
  unset = false,
  disabled = false,
}: ToneRangeSliderProps) {
  const range = max - min;
  const pct = range === 0 ? 0 : ((value - min) / range) * 100;
  return (
    <div className="relative px-16">
      <div className="relative h-7 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tone-slider"
        />
        {/* Filled portion of the track */}
        <div
          className="absolute top-1/2 left-0 -translate-y-1/2 h-1.5 rounded-full bg-[#fd8e33] pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* Visible thumb with value inside. NB: we set both `top` and the
            translate inline because Tailwind v4 uses the standalone CSS
            `translate` property for utilities like `-translate-y-1/2`, which
            would compose with any inline `transform: translate(...)` and
            shift the thumb twice. Keeping it all in one inline transform
            avoids that. */}
        <div
          className={`tone-slider-thumb absolute w-6 h-6 rounded-full ${
            unset ? "bg-gray-300" : "bg-[#fd8e33]"
          } flex items-center justify-center text-white pointer-events-none transition-shadow`}
          style={{
            top: "50%",
            left: `${pct}%`,
            transform: `translate(-${pct}%, -50%)`,
          }}
        >
          <span className="font-['Poppins',sans-serif] text-xs font-bold leading-none">
            {unset ? "—" : value}
          </span>
        </div>
      </div>
    </div>
  );
}

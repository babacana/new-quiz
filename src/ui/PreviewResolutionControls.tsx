import {
  PREVIEW_DIMENSION_LIMITS,
  PREVIEW_RESOLUTIONS,
  clampPreviewDimension,
} from '../domain/screenLayout';
import type { ResolutionChoice } from './usePreviewResolution';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select } from './components/ui/select';

const CUSTOM_RESOLUTION_ID = 'custom';

export interface PreviewResolutionControlsProps {
  resolution: ResolutionChoice;
  onChange: (next: ResolutionChoice) => void;
  /** Prefixo dos ids dos campos (evita colisão quando há mais de uma prévia na página). */
  idPrefix?: string;
}

export function PreviewResolutionControls({
  resolution,
  onChange,
  idPrefix = 'layout',
}: PreviewResolutionControlsProps) {
  const isCustomResolution = resolution.presetId === CUSTOM_RESOLUTION_ID;

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-resolution`}>Resolução da prévia</Label>
        <Select
          id={`${idPrefix}-resolution`}
          value={resolution.presetId}
          onChange={(e) => {
            const value = e.target.value;
            if (value === CUSTOM_RESOLUTION_ID) {
              onChange({ ...resolution, presetId: CUSTOM_RESOLUTION_ID });
              return;
            }
            const preset = PREVIEW_RESOLUTIONS.find((item) => item.id === value);
            if (preset) {
              onChange({
                presetId: preset.id,
                width: preset.width,
                height: preset.height,
              });
            }
          }}
        >
          {PREVIEW_RESOLUTIONS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM_RESOLUTION_ID}>Personalizada…</option>
        </Select>
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-width`}>Largura</Label>
          <Input
            id={`${idPrefix}-width`}
            type="number"
            inputMode="numeric"
            className="w-24"
            min={PREVIEW_DIMENSION_LIMITS.min}
            max={PREVIEW_DIMENSION_LIMITS.max}
            disabled={!isCustomResolution}
            value={resolution.width}
            onChange={(e) =>
              onChange({
                ...resolution,
                width: clampPreviewDimension(Number(e.target.value)),
              })
            }
          />
        </div>
        <span className="pb-2 text-muted-foreground">×</span>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-height`}>Altura</Label>
          <Input
            id={`${idPrefix}-height`}
            type="number"
            inputMode="numeric"
            className="w-24"
            min={PREVIEW_DIMENSION_LIMITS.min}
            max={PREVIEW_DIMENSION_LIMITS.max}
            disabled={!isCustomResolution}
            value={resolution.height}
            onChange={(e) =>
              onChange({
                ...resolution,
                height: clampPreviewDimension(Number(e.target.value)),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

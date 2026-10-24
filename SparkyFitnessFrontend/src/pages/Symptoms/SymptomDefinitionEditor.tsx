import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import {
  CUSTOM_FIELD_TYPES,
  SYMPTOM_DEFINITION_CATEGORIES,
  SYMPTOM_SCALE_TYPES,
  SYMPTOM_SECTIONS,
  SYMPTOM_TEMPLATES,
  TEMPLATE_SECTIONS,
  resolveSections,
  type CreateSymptomDefinitionBody,
  type CustomFieldType,
  type SymptomCustomFieldDef,
  type SymptomDefinitionCategory,
  type SymptomScaleType,
  type SymptomSection,
  type SymptomTemplate,
  slugifySymptomName,
  type SymptomChoice,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Timing and severity are what a log is made of, so they cannot be switched off.
const OPTIONAL_SECTIONS = SYMPTOM_SECTIONS.filter(
  (s) => s !== 'timing' && s !== 'severity'
);

interface FieldDraft {
  key?: string;
  label: string;
  type: CustomFieldType;
  options: string;
  unit: string;
}

interface SymptomDefinitionEditorProps {
  /** The symptom to edit; omit to create a new one. */
  choice?: SymptomChoice;
  saving: boolean;
  onSave: (body: CreateSymptomDefinitionBody) => void;
  onCancel: () => void;
}

const toFieldDrafts = (defs: SymptomCustomFieldDef[]): FieldDraft[] =>
  defs.map((d) => ({
    key: d.key,
    label: d.label,
    type: d.type,
    options: (d.options ?? []).join(', '),
    unit: d.unit ?? '',
  }));

/** Creates or edits a symptom: how it is rated, which sections show, and its own fields. */
export default function SymptomDefinitionEditor({
  choice,
  saving,
  onSave,
  onCancel,
}: SymptomDefinitionEditorProps) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(choice?.displayName ?? '');
  const [template, setTemplate] = useState<SymptomTemplate>(
    choice?.template ?? 'generic'
  );
  const [category, setCategory] = useState<SymptomDefinitionCategory>(
    choice?.category ?? 'general'
  );
  const [scale, setScale] = useState<SymptomScaleType>(
    choice?.scaleType ?? '1-10'
  );
  const [episodic, setEpisodic] = useState(choice?.isEpisodic ?? false);
  const [sections, setSections] = useState<Record<SymptomSection, boolean>>(
    choice?.sections ?? resolveSections(choice?.template ?? 'generic')
  );
  const [fields, setFields] = useState<FieldDraft[]>(
    toFieldDrafts(choice?.customFieldDefs ?? [])
  );

  const changeTemplate = (next: SymptomTemplate) => {
    setTemplate(next);
    setSections(resolveSections(next));
  };

  const save = () => {
    const label = displayName.trim();
    if (!label) return;
    // Only the differences from the template's defaults are stored, so a later
    // change to a template still reaches symptoms that never customised it.
    const defaults = TEMPLATE_SECTIONS[template];
    const overrides: Partial<Record<SymptomSection, boolean>> = {};
    for (const s of OPTIONAL_SECTIONS) {
      if (sections[s] !== defaults[s]) overrides[s] = sections[s];
    }
    const used = new Set<string>();
    const customFieldDefs: SymptomCustomFieldDef[] = fields
      .filter((f) => f.label.trim())
      .map((f) => {
        let key =
          f.key ??
          (slugifySymptomName(f.label).replace(/[^a-z0-9_]/g, '') || 'field');
        while (used.has(key)) key = `${key}_2`;
        used.add(key);
        const options = f.options
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);
        return {
          key,
          label: f.label.trim(),
          type: f.type,
          ...(f.type === 'select' || f.type === 'multiselect'
            ? { options }
            : {}),
          ...(f.unit.trim() ? { unit: f.unit.trim() } : {}),
        };
      });

    onSave({
      name: choice?.name ?? slugifySymptomName(label),
      display_name: label,
      template,
      category,
      scale_type: scale,
      is_episodic: episodic,
      sections: overrides,
      custom_field_defs: customFieldDefs,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="def-name">{t('symptoms.manage.name', 'Name')}</Label>
        <Input
          id="def-name"
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="def-template">
            {t('symptoms.manage.template', 'Type')}
          </Label>
          <Select
            value={template}
            onValueChange={(v) => changeTemplate(v as SymptomTemplate)}
          >
            <SelectTrigger id="def-template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMPTOM_TEMPLATES.map((tpl) => (
                <SelectItem key={tpl} value={tpl}>
                  {t(`symptoms.templates.${tpl}`, tpl)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="def-category">
            {t('symptoms.manage.category', 'Group')}
          </Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as SymptomDefinitionCategory)}
          >
            <SelectTrigger id="def-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMPTOM_DEFINITION_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`symptoms.categories.${c}`, c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="def-scale">
            {t('symptoms.manage.scale', 'Rated on')}
          </Label>
          <Select
            value={scale}
            onValueChange={(v) => setScale(v as SymptomScaleType)}
          >
            <SelectTrigger id="def-scale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMPTOM_SCALE_TYPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`symptoms.scales.${s}`, s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="def-episodic"
          checked={episodic}
          onCheckedChange={setEpisodic}
        />
        <Label htmlFor="def-episodic" className="font-normal">
          {t(
            'symptoms.manage.episodic',
            'Usually an episode with a start and end (like a migraine)'
          )}
        </Label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">
          {t('symptoms.manage.sections', 'What to ask when logging')}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONAL_SECTIONS.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sections[s]}
                onCheckedChange={(checked) =>
                  setSections((cur) => ({ ...cur, [s]: checked === true }))
                }
              />
              {t(`symptoms.manage.section.${s}`, s.replace(/_/g, ' '))}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">
          {t('symptoms.manage.fields', 'Your own fields')}
        </legend>
        {fields.map((f, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_8rem_auto] items-end gap-2"
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor={`def-field-${i}-label`} className="text-xs">
                {t('symptoms.manage.fieldLabel', 'Label')}
              </Label>
              <Input
                id={`def-field-${i}-label`}
                value={f.label}
                onChange={(e) =>
                  setFields((cur) =>
                    cur.map((x, idx) =>
                      idx === i ? { ...x, label: e.target.value } : x
                    )
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`def-field-${i}-type`} className="text-xs">
                {t('symptoms.manage.fieldType', 'Type')}
              </Label>
              <Select
                value={f.type}
                onValueChange={(v) =>
                  setFields((cur) =>
                    cur.map((x, idx) =>
                      idx === i ? { ...x, type: v as CustomFieldType } : x
                    )
                  )
                }
              >
                <SelectTrigger id={`def-field-${i}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>
                      {t(`symptoms.fieldTypes.${ft}`, ft)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('symptoms.manage.removeField', 'Remove field')}
              onClick={() =>
                setFields((cur) => cur.filter((_, idx) => idx !== i))
              }
            >
              <X className="h-4 w-4" />
            </Button>
            {(f.type === 'select' || f.type === 'multiselect') && (
              <Input
                className="col-span-3"
                value={f.options}
                placeholder={t(
                  'symptoms.manage.fieldOptions',
                  'Choices, separated by commas'
                )}
                aria-label={t(
                  'symptoms.manage.fieldOptions',
                  'Choices, separated by commas'
                )}
                onChange={(e) =>
                  setFields((cur) =>
                    cur.map((x, idx) =>
                      idx === i ? { ...x, options: e.target.value } : x
                    )
                  )
                }
              />
            )}
            {f.type === 'number' && (
              <Input
                className="col-span-3 max-w-32"
                value={f.unit}
                placeholder={t('symptoms.manage.fieldUnit', 'Unit (optional)')}
                aria-label={t('symptoms.manage.fieldUnit', 'Unit (optional)')}
                onChange={(e) =>
                  setFields((cur) =>
                    cur.map((x, idx) =>
                      idx === i ? { ...x, unit: e.target.value } : x
                    )
                  )
                }
              />
            )}
          </div>
        ))}
        {fields.length < 20 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() =>
              setFields((cur) => [
                ...cur,
                { label: '', type: 'number', options: '', unit: '' },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('symptoms.manage.addField', 'Add a field')}
          </Button>
        )}
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('symptoms.form.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={saving || !displayName.trim()}
        >
          {t('symptoms.chips.save', 'Save')}
        </Button>
      </div>
    </div>
  );
}

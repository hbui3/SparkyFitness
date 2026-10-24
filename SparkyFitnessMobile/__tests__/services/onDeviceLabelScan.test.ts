import type { OnDeviceLabelExtraction } from '../../modules/on-device-nutrition';

jest.mock('../../modules/on-device-nutrition', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(), scanLabel: jest.fn() },
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));

import mockModuleImport from '../../modules/on-device-nutrition';
import { useAppPreferencesStore } from '../../src/stores/appPreferencesStore';
import {
  isGroundedInLabelText,
  isPlausibleLabel,
  scanLabelOnDevice,
  toLabelScanResult,
} from '../../src/services/onDeviceLabelScan';

const mockModule = jest.mocked(mockModuleImport!);

const label = (over: Partial<OnDeviceLabelExtraction> = {}) =>
  ({
    name: 'Granola',
    brand: 'Acme',
    serving_size: 40,
    serving_unit: 'g',
    calories: 180,
    protein: 4,
    carbs: 26,
    fat: 7,
    fiber: null,
    saturated_fat: null,
    trans_fat: null,
    sodium: null,
    sugars: null,
    cholesterol: null,
    potassium: null,
    calcium: null,
    iron: null,
    values_are_per_100: false,
    ...over,
  }) as OnDeviceLabelExtraction;

describe('onDeviceLabelScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModule.isAvailable.mockReturnValue(true);
    useAppPreferencesStore.setState({ onDeviceLabelScanEnabled: true });
  });

  it('accepts a coherent label', () => {
    expect(isPlausibleLabel(label())).toBe(true);
  });

  it.each([
    ['missing calories', { calories: null }],
    ['sugars above carbs', { sugars: 40 }],
    ['saturated fat above fat', { saturated_fat: 20 }],
    ['negative value', { protein: -1 }],
    ['energy far from macros', { calories: 900 }],
  ])('rejects %s', (_name, over) => {
    expect(isPlausibleLabel(label(over))).toBe(false);
  });

  it('accepts values printed in the label text', () => {
    const r = label({
      ocr_text:
        'Serving size 40g\nCalories 180\nProtein 4g\nTotal Carbohydrate 26,0g\nFat 7g',
    });
    expect(isGroundedInLabelText(r)).toBe(true);
  });

  it('reads a comma between groups of three as a thousands separator', () => {
    const r = label({
      calories: 1000,
      protein: 4,
      carbs: 26,
      fat: 7,
      ocr_text:
        'Serving size 40g\nEnergy 1,000 kcal\nProtein 4g\nCarbs 26g\nFat 7g',
    });
    expect(isGroundedInLabelText(r)).toBe(true);
    // The same text must not also read as 1.
    expect(isGroundedInLabelText({ ...r, calories: 1 } as typeof r)).toBe(
      false
    );
  });

  it('still reads a decimal comma', () => {
    const r = label({
      calories: 180,
      protein: 4.5,
      carbs: 26,
      fat: 0.5,
      ocr_text:
        'Serving size 40g\nCalories 180\nProtein 4,5g\nCarbs 26g\nFat 0,500g',
    });
    expect(isGroundedInLabelText(r)).toBe(true);
  });

  it('rejects a mix of the per-serving and per-100 columns', () => {
    const ocr = [
      'Serving size 40g',
      'Per serving Per 100g',
      'Calories 100 400',
      'Protein 2.5g 10g',
      'Carbohydrate 15g 60g',
      'Fat 3.75g 15g',
    ].join('\n');
    expect(
      isGroundedInLabelText(
        label({
          calories: 100,
          protein: 10,
          carbs: 15,
          fat: 3.75,
          values_are_per_100: false,
          ocr_text: ocr,
        })
      )
    ).toBe(false);
  });

  it('accepts every macro from the column the model selected', () => {
    const ocr = [
      'Serving size 40g',
      'Per serving Per 100g',
      'Calories 100 400',
      'Protein 2.5g 10g',
      'Carbohydrate 15g 60g',
      'Fat 3.75g 15g',
    ].join('\n');
    expect(
      isGroundedInLabelText(
        label({
          calories: 100,
          protein: 2.5,
          carbs: 15,
          fat: 3.75,
          values_are_per_100: false,
          ocr_text: ocr,
        })
      )
    ).toBe(true);
    expect(
      isGroundedInLabelText(
        label({
          calories: 400,
          protein: 10,
          carbs: 60,
          fat: 15,
          values_are_per_100: true,
          ocr_text: ocr,
        })
      )
    ).toBe(true);
  });

  it('rejects a mix even when the label has no column header', () => {
    const ocr = [
      'Calories 100 400',
      'Protein 2.5g 10g',
      'Carbohydrate 15g 60g',
      'Fat 3.75g 15g',
    ].join('\n');
    expect(
      isGroundedInLabelText(
        label({
          calories: 100,
          protein: 10,
          carbs: 15,
          fat: 3.75,
          ocr_text: ocr,
        })
      )
    ).toBe(false);
  });

  it('rejects a macro that is not in the label text', () => {
    const r = label({
      ocr_text: 'Calories 180\nProtein 5g\nCarbs 26g\nFat 7g',
    });
    expect(isGroundedInLabelText(r)).toBe(false);
  });

  it('rejects a serving size that is not printed on the label', () => {
    const r = label({
      serving_size: 40,
      ocr_text: 'Calories 180\nProtein 4g\nCarbs 26g\nFat 7g',
    });
    expect(isGroundedInLabelText(r)).toBe(false);
  });

  it('rejects an optional nutrient that is not printed', () => {
    expect(
      isGroundedInLabelText(
        label({
          fiber: 3,
          ocr_text:
            'Serving size 40g\nCalories 180\nProtein 4g\nCarbs 26g\nFat 7g',
        })
      )
    ).toBe(false);
  });

  it('accepts optional nutrients that are printed', () => {
    expect(
      isGroundedInLabelText(
        label({
          fiber: 3,
          sodium: 90,
          ocr_text:
            'Serving size 40g\nCalories 180\nProtein 4g\nCarbs 26g\nFat 7g\nFiber 3g\nSodium 90mg',
        })
      )
    ).toBe(true);
  });

  it('rejects an optional value that only matches another nutrient', () => {
    expect(
      isGroundedInLabelText(
        label({
          fiber: 4,
          ocr_text:
            'Serving size 40g\nCalories 180\nProtein 4g\nCarbs 26g\nFat 7g',
        })
      )
    ).toBe(false);
  });

  it('does not trust values when no text was recognised', () => {
    expect(isGroundedInLabelText(label({ ocr_text: '' }))).toBe(false);
    expect(isGroundedInLabelText(label())).toBe(false);
  });

  it('maps per-100 labels to a 100 g serving', () => {
    const r = toLabelScanResult(
      label({ values_are_per_100: true, serving_size: 40 })
    );
    expect(r.serving_size).toBe(100);
    expect(r.serving_unit).toBe('g');
  });

  it('returns the mapped result when the model output is valid', async () => {
    mockModule.scanLabel.mockResolvedValue(
      label({
        ocr_text: 'Serving size 40g Calories 180 Protein 4 Carbs 26 Fat 7',
      })
    );
    const r = await scanLabelOnDevice('b64');
    expect(r?.calories).toBe(180);
    expect(r?.vitamin_c).toBeNull();
  });

  it('falls back when the serving size is not printed', async () => {
    mockModule.scanLabel.mockResolvedValue(
      label({
        serving_size: 40,
        ocr_text: 'Calories 180 Protein 4 Carbs 26 Fat 7',
      })
    );
    expect(await scanLabelOnDevice('b64')).toBeNull();
  });

  it('falls back when the label text could not be read', async () => {
    mockModule.scanLabel.mockResolvedValue(label({ ocr_text: '' }));
    expect(await scanLabelOnDevice('b64')).toBeNull();
  });

  it('falls back when a per-serving label has no serving size', async () => {
    mockModule.scanLabel.mockResolvedValue(
      label({
        serving_size: null,
        ocr_text: 'Calories 180 Protein 4 Carbs 26 Fat 7',
      })
    );
    expect(await scanLabelOnDevice('b64')).toBeNull();
  });

  it('keeps a per-100 label that has no serving size', async () => {
    mockModule.scanLabel.mockResolvedValue(
      label({
        serving_size: null,
        values_are_per_100: true,
        ocr_text: 'Calories 180 Protein 4 Carbs 26 Fat 7',
      })
    );
    const result = await scanLabelOnDevice('b64');
    expect(result?.serving_size).toBe(100);
    expect(result?.serving_unit).toBe('g');
  });

  it('returns null when unavailable, throwing, or implausible', async () => {
    mockModule.isAvailable.mockReturnValue(false);
    expect(await scanLabelOnDevice('b64')).toBeNull();
    expect(mockModule.scanLabel).not.toHaveBeenCalled();

    mockModule.isAvailable.mockReturnValue(true);
    mockModule.scanLabel.mockRejectedValue(new Error('boom'));
    expect(await scanLabelOnDevice('b64')).toBeNull();

    mockModule.scanLabel.mockResolvedValue(label({ calories: 900 }));
    expect(await scanLabelOnDevice('b64')).toBeNull();
  });

  it('skips the on-device model when the setting is off', async () => {
    useAppPreferencesStore.setState({ onDeviceLabelScanEnabled: false });
    mockModule.scanLabel.mockResolvedValue(label());
    expect(await scanLabelOnDevice('b64')).toBeNull();
    expect(mockModule.scanLabel).not.toHaveBeenCalled();
  });
});

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { scanNutritionLabel } from '../services/api/externalFoodSearchApi';
import {
  isOnDeviceLabelScanAvailable,
  scanLabelOnDevice,
} from '../services/onDeviceLabelScan';
import {
  clearLabelScanSession,
  getLabelScanGeneration,
  getLabelScanPhoto,
  rememberLabelScan,
  type LabelScanSource,
} from '../services/labelScanSession';
import { labelScanToInitialFood } from '../utils/labelScanFood';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import type { RootStackScreenProps } from '../types/navigation';

type FoodFormProps = RootStackScreenProps<'FoodForm'>;
type CreateFoodParams = Extract<
  FoodFormProps['route']['params'],
  { mode: 'create-food' }
>;

/**
 * Has the other AI read the label again, for a food form filled in from a
 * label scan. The same photo is read and the form is replaced with the result.
 */
export function useRetryLabelScan(
  params: CreateFoodParams,
  navigation: FoodFormProps['navigation']
) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const onDeviceEnabled = useAppPreferencesStore(
    (s) => s.onDeviceLabelScanEnabled
  );
  const source = params.labelScanSource;
  const [hasPhoto] = useState(() => getLabelScanPhoto() != null);
  // Free the photo when the form closes, saved or not.
  const [generation] = useState(getLabelScanGeneration);
  useEffect(() => () => clearLabelScanSession(generation), [generation]);
  // Going to the server needs nothing; coming back needs the on-device scan.
  const canRetry =
    hasPhoto &&
    (source === 'device' ||
      (source === 'server' &&
        onDeviceEnabled &&
        isOnDeviceLabelScanAvailable()));

  const retry = async () => {
    const photo = getLabelScanPhoto();
    const capturedGeneration = getLabelScanGeneration();
    if (!photo || !source || retrying) return;
    const to: LabelScanSource = source === 'device' ? 'server' : 'device';
    setRetrying(true);
    try {
      const result =
        to === 'server'
          ? await scanNutritionLabel(photo, 'image/jpeg')
          : await scanLabelOnDevice(photo);
      // A newer scan replaced this photo while the read was in flight.
      if (getLabelScanGeneration() !== capturedGeneration) return;
      if (!result) {
        Toast.show({
          type: 'error',
          text1: t('common.error', { defaultValue: 'Error' }),
          text2: t('foodScan.errors.retryOnDevice', {
            defaultValue: 'This iPhone could not read the label.',
          }),
        });
        return;
      }
      rememberLabelScan(photo, to);
      navigation.replace('FoodForm', {
        ...params,
        initialFood: labelScanToInitialFood(result),
        labelScanSource: to,
        pendingScannedBarcode: undefined,
        scannedBarcodeNonce: undefined,
      });
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common.error', { defaultValue: 'Error' }),
        text2: t('foodScan.errors.analyzeLabel', {
          defaultValue: 'Failed to analyze nutrition label. Please try again.',
        }),
      });
    } finally {
      setRetrying(false);
    }
  };

  return { canRetry, retry: () => void retry(), retrying };
}

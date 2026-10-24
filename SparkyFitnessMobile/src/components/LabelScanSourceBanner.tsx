import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import type { LabelScanSource } from '../services/labelScanSession';

interface LabelScanSourceBannerProps {
  /** Which AI read the label that filled in the form. */
  source: LabelScanSource;
  /** Reading the label again with the other AI. Omitted when it is not possible. */
  onRetry?: () => void;
  busy?: boolean;
}

/** Says which AI read the label, with a way to have the other one try. */
const LabelScanSourceBanner: React.FC<LabelScanSourceBannerProps> = ({
  source,
  onRetry,
  busy = false,
}) => {
  const { t } = useTranslation();
  const readBy =
    source === 'device'
      ? t('foodScan.labelReadOnDevice', {
          defaultValue: 'Label read on this iPhone',
        })
      : t('foodScan.labelReadByServer', {
          defaultValue: 'Label read by the server AI',
        });
  const retryLabel =
    source === 'device'
      ? t('foodScan.retryWithServer', {
          defaultValue: 'Read again with the server AI',
        })
      : t('foodScan.retryOnDevice', {
          defaultValue: 'Read again on this iPhone',
        });

  return (
    <View className="bg-surface rounded-xl p-3 mb-4 shadow-sm">
      <Text testID="label-scan-source" className="text-text-primary text-sm">
        {readBy}
      </Text>
      {onRetry && (
        <TouchableOpacity
          testID="label-scan-retry"
          onPress={onRetry}
          disabled={busy}
          activeOpacity={0.7}
          accessibilityRole="button"
          className="flex-row items-center gap-2 mt-2 self-start"
        >
          {busy && <ActivityIndicator size="small" />}
          <Text className="text-accent-primary text-base font-medium">
            {retryLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default LabelScanSourceBanner;

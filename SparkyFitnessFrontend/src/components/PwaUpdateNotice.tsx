import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isPwaUpdateAvailable,
  subscribeToPwaUpdate,
} from '@/utils/pwaReleaseRefresh';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function PwaUpdateNotice() {
  const { t } = useTranslation();
  const available = useSyncExternalStore(
    subscribeToPwaUpdate,
    isPwaUpdateAvailable
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!available) return null;
  return (
    <>
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b bg-background p-3 shadow-md"
      >
        <p className="text-sm">
          {t(
            'pwa.updateReady',
            'An update is ready. Save your work before reloading.'
          )}
        </p>
        <Button size="sm" onClick={() => setConfirmOpen(true)}>
          {t('pwa.reload', 'Reload')}
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('pwa.reloadTitle', 'Reload the app now?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'pwa.reloadDescription',
                'Unsaved changes will be lost. Cancel to finish and save your current work first.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => window.location.reload()}>
              {t('pwa.reload', 'Reload')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

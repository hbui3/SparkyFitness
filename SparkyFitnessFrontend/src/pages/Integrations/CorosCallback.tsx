import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { CallbackStatus } from './CallbackStatus';
import { useCorosMutation } from '@/hooks/Integrations/useIntegrations';

const CorosCallback = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(
    t('integrations.corosProcessingAuth', 'Processing COROS authorization...')
  );
  const { mutateAsync: linkCoros } = useCorosMutation();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const processCallback = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const state = params.get('state');

      if (!code || !state) {
        setMessage(
          t(
            'integrations.corosMissingCodeOrState',
            'Error: Missing COROS authorization code or state.'
          )
        );
        toast({
          title: t('integrations.corosOAuthError', 'COROS OAuth Error'),
          description: t(
            'integrations.corosMissingParams',
            'Missing authorization code or state in callback.'
          ),
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      try {
        await linkCoros({ code, state });
        setMessage(
          t(
            'integrations.corosLinkSuccessMsg',
            'COROS account successfully linked!'
          )
        );
      } catch (error: unknown) {
        setMessage(
          t('integrations.corosLinkErrorMsg', 'Error linking COROS account.')
        );
      } finally {
        setLoading(false);
        setTimeout(() => {
          navigate('/settings');
        }, 1500);
      }
    };

    processCallback();
  }, [location, navigate, toast, linkCoros, t]);

  return <CallbackStatus loading={loading} message={message} />;
};

export default CorosCallback;

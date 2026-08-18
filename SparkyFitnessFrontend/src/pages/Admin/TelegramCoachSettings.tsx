import { useState, type FormEvent } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useRemoveTelegramCoachSettings,
  useTelegramCoachSettings,
  useUpdateTelegramCoachSettings,
} from '@/hooks/Admin/useTelegramCoachSettings';

export default function TelegramCoachSettings() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useTelegramCoachSettings();
  const update = useUpdateTelegramCoachSettings();
  const remove = useRemoveTelegramCoachSettings();
  const [botToken, setBotToken] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(botToken.trim(), {
      onSuccess: () => setBotToken(''),
    });
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="telegram-coach" className="border rounded-lg">
        <AccordionTrigger
          className="flex items-center gap-2 p-4 hover:no-underline"
          description={t(
            'admin.telegramCoach.description',
            'Configure the instance-wide Telegram bot used for private coach messages.'
          )}
        >
          <Bot className="h-5 w-5" />
          {t('admin.telegramCoach.title', 'Telegram Coach')}
        </AccordionTrigger>
        <AccordionContent className="p-4 pt-0 space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              {t('admin.telegramCoach.loading', 'Loading configuration…')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={settings?.configured ? 'default' : 'secondary'}>
                  {settings?.configured
                    ? t('admin.telegramCoach.configured', 'Configured')
                    : t('admin.telegramCoach.notConfigured', 'Not configured')}
                </Badge>
                {settings?.botUsername && (
                  <span className="text-sm font-medium">
                    @{settings.botUsername}
                  </span>
                )}
                {settings?.source !== 'none' && (
                  <span className="text-xs text-muted-foreground">
                    {settings?.source === 'database'
                      ? t(
                          'admin.telegramCoach.databaseSource',
                          'Encrypted database storage'
                        )
                      : t(
                          'admin.telegramCoach.environmentSource',
                          'Environment fallback'
                        )}
                  </span>
                )}
              </div>

              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="telegram-bot-token">
                    {t('admin.telegramCoach.botToken', 'BotFather token')}
                  </Label>
                  <Input
                    id="telegram-bot-token"
                    type="password"
                    autoComplete="off"
                    value={botToken}
                    onChange={(event) => setBotToken(event.target.value)}
                    placeholder={
                      settings?.databaseTokenStored
                        ? t(
                            'admin.telegramCoach.replacePlaceholder',
                            'Enter a new token to replace the saved token'
                          )
                        : '123456789:AA…'
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'admin.telegramCoach.tokenPrivacy',
                      'The token is validated with Telegram, encrypted before database storage, and never returned to the browser.'
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={botToken.trim().length < 20 || update.isPending}
                  >
                    {update.isPending
                      ? t(
                          'admin.telegramCoach.validating',
                          'Validating and saving…'
                        )
                      : t(
                          'admin.telegramCoach.save',
                          'Validate and save token'
                        )}
                  </Button>
                  {settings?.databaseTokenStored && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate()}
                    >
                      {t('admin.telegramCoach.remove', 'Remove saved token')}
                    </Button>
                  )}
                </div>
              </form>

              <div className="rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t('admin.telegramCoach.webhook', 'Webhook')}:{' '}
                </span>
                {settings?.webhookUrl ??
                  t(
                    'admin.telegramCoach.webhookUnavailable',
                    'No public frontend URL configured'
                  )}
              </div>
            </>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

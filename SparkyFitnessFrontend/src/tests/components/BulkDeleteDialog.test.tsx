import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import i18n from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import BulkDeleteDialog from '@/components/BulkDeleteDialog';
import en from '../../../public/locales/en/translation.json';
import de from '../../../public/locales/de/translation.json';
import es from '../../../public/locales/es/translation.json';
import ar from '../../../public/locales/ar/translation.json';

describe('BulkDeleteDialog', () => {
  beforeAll(async () => {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        de: { translation: de },
        es: { translation: es },
        ar: { translation: ar },
      },
      interpolation: {
        escapeValue: false,
      },
    });
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders title and description with interpolated count in English', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <BulkDeleteDialog
          isOpen={true}
          onOpenChange={jest.fn()}
          onConfirm={jest.fn()}
          selectedCount={5}
          entityName="presets"
        />
      </I18nextProvider>
    );

    expect(screen.getByText('Delete 5 presets?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Are you sure you want to delete these 5 items? This action cannot be undone.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{selectedCount\}\}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\{\{count\}\}/)).not.toBeInTheDocument();
  });

  it('renders custom description when supplied', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <BulkDeleteDialog
          isOpen={true}
          onOpenChange={jest.fn()}
          onConfirm={jest.fn()}
          selectedCount={3}
          entityName="exercises"
          description="Remove these 3 exercises from your library."
        />
      </I18nextProvider>
    );

    expect(
      screen.getByText('Remove these 3 exercises from your library.')
    ).toBeInTheDocument();
  });

  it.each(['en', 'de', 'es', 'ar'])(
    'interpolates counts without raw placeholders in %s',
    async (lng) => {
      await act(async () => {
        await i18n.changeLanguage(lng);
      });

      const { container } = render(
        <I18nextProvider i18n={i18n}>
          <BulkDeleteDialog
            isOpen={true}
            onOpenChange={jest.fn()}
            onConfirm={jest.fn()}
            selectedCount={4}
            entityName="items"
          />
        </I18nextProvider>
      );

      const text = container.textContent || '';
      expect(text).not.toContain('{{selectedCount}}');
      expect(text).not.toContain('{{count}}');
      expect(text).not.toContain('{{entityName}}');
      expect(text).not.toContain('{{entity}}');
    }
  );

  it('calls onConfirm when Delete button is clicked', () => {
    const onConfirm = jest.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <BulkDeleteDialog
          isOpen={true}
          onOpenChange={jest.fn()}
          onConfirm={onConfirm}
          selectedCount={2}
        />
      </I18nextProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

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
import BulkActionToolbar from '@/components/BulkActionToolbar';
import en from '../../../public/locales/en/translation.json';
import de from '../../../public/locales/de/translation.json';
import es from '../../../public/locales/es/translation.json';
import ar from '../../../public/locales/ar/translation.json';

describe('BulkActionToolbar', () => {
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

  it('renders nothing when selectedCount is 0', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <BulkActionToolbar
          selectedCount={0}
          totalCount={10}
          allSelected={false}
          onClear={jest.fn()}
          onDelete={jest.fn()}
          onSelectAll={jest.fn()}
        />
      </I18nextProvider>
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the selected count without raw interpolation placeholders in English', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <BulkActionToolbar
          selectedCount={3}
          totalCount={12}
          allSelected={false}
          onClear={jest.fn()}
          onDelete={jest.fn()}
          onSelectAll={jest.fn()}
        />
      </I18nextProvider>
    );

    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText('out of 12 items')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{selectedCount\}\}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\{\{count\}\}/)).not.toBeInTheDocument();
  });

  it.each(['en', 'de', 'es', 'ar'])(
    'interpolates selectedCount without raw placeholders in %s',
    async (lng) => {
      await act(async () => {
        await i18n.changeLanguage(lng);
      });

      const { container } = render(
        <I18nextProvider i18n={i18n}>
          <BulkActionToolbar
            selectedCount={4}
            totalCount={20}
            allSelected={false}
            onClear={jest.fn()}
            onDelete={jest.fn()}
            onSelectAll={jest.fn()}
          />
        </I18nextProvider>
      );

      const text = container.textContent || '';
      expect(text).not.toContain('{{selectedCount}}');
      expect(text).not.toContain('{{count}}');
      expect(text).not.toContain('{{totalCount}}');
      expect(text).not.toContain('{{total}}');
    }
  );

  it('triggers onClear, onDelete, and onSelectAll callbacks', () => {
    const onClear = jest.fn();
    const onDelete = jest.fn();
    const onSelectAll = jest.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <BulkActionToolbar
          selectedCount={2}
          totalCount={5}
          allSelected={false}
          onClear={onClear}
          onDelete={onDelete}
          onSelectAll={onSelectAll}
        />
      </I18nextProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClear).toHaveBeenCalledTimes(1);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onSelectAll).toHaveBeenCalledWith(true);
  });
});

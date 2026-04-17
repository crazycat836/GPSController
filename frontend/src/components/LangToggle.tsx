import React from 'react';
import { useI18n } from '../i18n';

const LangToggle: React.FC = () => {
  const { lang, setLang } = useI18n();

  const btnClass = (active: boolean) =>
    [
      'min-h-[36px] px-2 inline-flex items-center justify-center text-sm font-medium cursor-pointer transition-colors bg-transparent border-b-2',
      'focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
      active
        ? 'text-[var(--color-accent)] border-[var(--color-accent)] font-semibold'
        : 'text-[var(--color-text-3)] border-transparent hover:text-[var(--color-text-2)]',
    ].join(' ');

  return (
    <div className="inline-flex items-center gap-0.5" title="Language / 語言">
      <button
        type="button"
        aria-pressed={lang === 'zh'}
        aria-label="Switch to Chinese"
        className={btnClass(lang === 'zh')}
        onClick={() => setLang('zh')}
      >
        中文
      </button>
      <span aria-hidden="true" className="text-[var(--color-text-3)]">|</span>
      <button
        type="button"
        aria-pressed={lang === 'en'}
        aria-label="Switch to English"
        className={btnClass(lang === 'en')}
        onClick={() => setLang('en')}
      >
        EN
      </button>
    </div>
  );
};

export default LangToggle;

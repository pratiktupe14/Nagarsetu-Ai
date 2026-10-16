import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  SupportedLanguage,
  t as tFunction,
  translateStatus as translateStatusFn,
  translateCategory as translateCategoryFn,
  translatePriority as translatePriorityFn,
  translateDepartment as translateDepartmentFn,
  translateSeverity as translateSeverityFn,
  translateRole as translateRoleFn,
  translateLocationSource as translateLocationSourceFn,
  translateDraftStatus as translateDraftStatusFn
} from '../utils/i18n';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface LanguageContextType {
  lang: SupportedLanguage;
  language: SupportedLanguage;
  changeLanguage: (newLang: SupportedLanguage) => Promise<void>;
  setLanguage: (newLang: SupportedLanguage) => Promise<void>;
  t: (key: string) => string;
  translateStatus: (status?: string) => string;
  translateCategory: (category?: string) => string;
  translatePriority: (priority?: string) => string;
  translateDepartment: (department?: string) => string;
  translateSeverity: (severity?: string) => string;
  translateRole: (role?: string) => string;
  translateLocationSource: (source?: string) => string;
  translateDraftStatus: (status?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const user = auth?.user;

  const [lang, setLang] = useState<SupportedLanguage>(() => {
    const savedLocal = localStorage.getItem('nagarsetu_lang') as SupportedLanguage;
    if (savedLocal && ['en', 'hi', 'mr'].includes(savedLocal)) {
      return savedLocal;
    }
    const savedUserPref = user?.language_pref as SupportedLanguage;
    if (savedUserPref && ['en', 'hi', 'mr'].includes(savedUserPref)) {
      return savedUserPref;
    }
    return 'en';
  });

  // Sync state if user changes in AuthContext or has loaded profile preference
  useEffect(() => {
    const savedLocal = localStorage.getItem('nagarsetu_lang') as SupportedLanguage;
    if (savedLocal && ['en', 'hi', 'mr'].includes(savedLocal)) {
      setLang((current) => (savedLocal !== current ? savedLocal : current));
      return;
    }
    if (user?.language_pref && ['en', 'hi', 'mr'].includes(user.language_pref)) {
      const userLang = user.language_pref as SupportedLanguage;
      setLang((current) => {
        if (userLang !== current) {
          localStorage.setItem('nagarsetu_lang', userLang);
          return userLang;
        }
        return current;
      });
    }
  }, [user?.id, user?.language_pref]);

  const changeLanguage = async (newLang: SupportedLanguage) => {
    if (!['en', 'hi', 'mr'].includes(newLang)) return;
    
    setLang(newLang);
    localStorage.setItem('nagarsetu_lang', newLang);

    // Save to database via authoritative API and synchronize profiles
    if (user && user.id) {
      if (auth?.updateUserProfile) {
        try {
          await auth.updateUserProfile({ language_pref: newLang });
        } catch (err) {
          console.warn('Could not persist preferred_language to API profile:', err);
        }
      } else if (isSupabaseConfigured()) {
        try {
          await supabase
            .from('profiles')
            .update({ language_pref: newLang })
            .eq('id', user.id);
        } catch (err) {
          console.warn('Could not persist preferred_language to Supabase profile:', err);
        }
      }
    }
  };

  const t = (key: string): string => tFunction(key, lang);
  const translateStatus = (status?: string): string => translateStatusFn(status, lang);
  const translateCategory = (category?: string): string => translateCategoryFn(category, lang);
  const translatePriority = (priority?: string): string => translatePriorityFn(priority, lang);
  const translateDepartment = (department?: string): string => translateDepartmentFn(department, lang);
  const translateSeverity = (severity?: string): string => translateSeverityFn(severity, lang);
  const translateRole = (role?: string): string => translateRoleFn(role, lang);
  const translateLocationSource = (source?: string): string => translateLocationSourceFn(source, lang);
  const translateDraftStatus = (status?: string): string => translateDraftStatusFn(status, lang);

  return (
    <LanguageContext.Provider
      value={{
        lang,
        language: lang,
        changeLanguage,
        setLanguage: changeLanguage,
        t,
        translateStatus,
        translateCategory,
        translatePriority,
        translateDepartment,
        translateSeverity,
        translateRole,
        translateLocationSource,
        translateDraftStatus
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    // Fallback safe dummy context if used outside provider during initialization
    return {
      lang: 'en',
      language: 'en',
      changeLanguage: async () => {},
      setLanguage: async () => {},
      t: (key: string) => tFunction(key, 'en'),
      translateStatus: (status?: string) => translateStatusFn(status, 'en'),
      translateCategory: (category?: string) => translateCategoryFn(category, 'en'),
      translatePriority: (priority?: string) => translatePriorityFn(priority, 'en'),
      translateDepartment: (department?: string) => translateDepartmentFn(department, 'en'),
      translateSeverity: (severity?: string) => translateSeverityFn(severity, 'en'),
      translateRole: (role?: string) => translateRoleFn(role, 'en'),
      translateLocationSource: (source?: string) => translateLocationSourceFn(source, 'en'),
      translateDraftStatus: (status?: string) => translateDraftStatusFn(status, 'en')
    };
  }
  return context;
};

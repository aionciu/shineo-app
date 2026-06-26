import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type AppConfig = Record<string, string>;

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('app_config')
      .select('key, value')
      .then(({ data }) => {
        if (data) {
          const map: AppConfig = {};
          for (const row of data) map[row.key] = row.value;
          setConfig(map);
        }
        setIsLoading(false);
      });
  }, []);

  return { config, isLoading };
}

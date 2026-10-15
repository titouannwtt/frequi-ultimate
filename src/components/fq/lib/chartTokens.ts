import { computed } from 'vue';

import { readChartTokens, type ChartTokens } from '@/components/ds/lib/chartTheme';
import { useDocumentAppearance } from '@/components/ds/lib/useDocumentTheme';
import { readCssToken } from '@/utils/designTokens';

/** The design system chart tokens plus the critical colour (liquidation lines). */
export type FqChartTokens = ChartTokens & { crit: string };

export function readFqChartTokens(): FqChartTokens {
  return { ...readChartTokens(), crit: readCssToken('--crit', '#ff6a3d') };
}

/**
 * Chart tokens that follow the theme and the colour-blind palette: a computed option that reads
 * `tokens.value` is rebuilt when either changes (the ECharts theme itself is rebuilt by BaseChart).
 */
export function useChartTokens() {
  const { theme, cvd } = useDocumentAppearance();
  const tokens = computed<FqChartTokens>(() => {
    // The attributes are read by readChartTokens; these refs only retrigger the computed
    void theme.value;
    void cvd.value;
    return readFqChartTokens();
  });
  return { tokens, theme, cvd };
}

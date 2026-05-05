import type { ElementEvent } from 'echarts';
import humanizeDuration from 'humanize-duration';
import type ECharts from 'vue-echarts';
import type { Ref } from 'vue';

export function usePercentageTool(
  chartRef: Ref<InstanceType<typeof ECharts> | null>,
  theme: Ref<string>,
  timeframe_ms: Ref<number>,
) {
  const inputListener = useKeyModifier('Shift', { events: ['keydown', 'keyup'] });

  const startPos = ref({ x: 0, y: 0 });
  const drawLimitPerSecond = 144;
  const canDraw = ref(true);
  const active = ref(false);
  const closing = ref(false);

  // TradingView-style label dimensions
  const labelH = 28;
  const labelW = 220;

  function roundTF(timestamp: number) {
    return roundTimeframe(timeframe_ms.value, timestamp, ROUND_CLOSER);
  }

  function mouseMove(e: ElementEvent) {
    if (canDraw.value && !closing.value) draw(e.offsetX, e.offsetY);
  }

  function mouseDown(e: ElementEvent) {
    if (!active.value) {
      const startValues = chartRef.value?.convertFromPixel({ seriesIndex: 0 }, [
        e.offsetX,
        e.offsetY,
      ]) ?? [0, 0];
      startValues[0] = roundTF(Number(startValues[0]));
      const startnew = chartRef.value?.convertToPixel({ seriesIndex: 0 }, startValues) ?? [0, 0];

      startPos.value = { x: startnew[0]!, y: startnew[1]! };

      chartRef.value?.chart?.getZr().on('mousemove', mouseMove);
      drawStart();
    } else if (!closing.value) {
      closing.value = true;
    } else {
      drawEnd();
      closing.value = false;
      chartRef.value?.chart?.getZr().off('mousemove', mouseMove);
      chartRef.value?.chart?.getZr().off('mousedown', mouseDown);
    }
  }

  function drawStart() {
    active.value = true;
    chartRef.value?.setOption({
      dataZoom: [{ disabled: true }],
      graphic: [
        {
          // Selection area — gradient fill
          id: 'pct-area',
          type: 'rect',
          z: 3,
          shape: {
            x: startPos.value.x,
            width: 0,
            y: startPos.value.y,
            height: 0,
          },
          style: {
            fill: 'rgba(99, 102, 241, 0.06)',
          },
        },
        {
          // Left vertical dashed line
          id: 'pct-line-start',
          type: 'line',
          z: 4,
          shape: {
            x1: startPos.value.x,
            y1: 0,
            x2: startPos.value.x,
            y2: 2000,
          },
          style: {
            stroke: 'rgba(99, 102, 241, 0.25)',
            lineWidth: 1,
            lineDash: [3, 3],
          },
        },
        {
          // Right vertical dashed line
          id: 'pct-line-end',
          type: 'line',
          z: 4,
          shape: {
            x1: startPos.value.x,
            y1: 0,
            x2: startPos.value.x,
            y2: 2000,
          },
          style: {
            stroke: 'rgba(99, 102, 241, 0.25)',
            lineWidth: 1,
            lineDash: [3, 3],
          },
        },
        {
          // Horizontal connector line
          id: 'pct-hline',
          type: 'line',
          z: 4,
          shape: {
            x1: startPos.value.x,
            y1: startPos.value.y,
            x2: startPos.value.x,
            y2: startPos.value.y,
          },
          style: {
            stroke: 'rgba(99, 102, 241, 0.4)',
            lineWidth: 1,
            lineDash: [4, 4],
          },
        },
        {
          // Label pill
          id: 'pct-label',
          type: 'rect',
          z: 6,
          shape: {
            x: startPos.value.x,
            width: labelW,
            y: startPos.value.y,
            height: labelH,
            r: 4,
          },
          style: {
            fill: 'rgba(99, 102, 241, 0.9)',
            shadowBlur: 8,
            shadowColor: 'rgba(99, 102, 241, 0.3)',
            shadowOffsetY: 2,
          },
          textContent: {
            z: 10,
            style: {
              text: '0 bars  |  0.00%  |  0s',
              font: '600 11px "Inter", system-ui, sans-serif',
              fill: 'white',
              padding: [0, 8],
            },
          },
          textConfig: {
            position: 'inside',
          },
        },
      ],
    });
  }

  function drawEnd() {
    active.value = false;
    chartRef.value?.setOption({
      dataZoom: [{ disabled: false }],
      graphic: [
        { id: 'pct-area', $action: 'remove' },
        { id: 'pct-line-start', $action: 'remove' },
        { id: 'pct-line-end', $action: 'remove' },
        { id: 'pct-hline', $action: 'remove' },
        { id: 'pct-label', $action: 'remove' },
      ],
    });
  }

  function draw(x: number, y: number) {
    const startValues = chartRef.value?.convertFromPixel({ seriesIndex: 0 }, [
      startPos.value.x,
      startPos.value.y,
    ]) ?? [0, 0];
    const endValues = chartRef.value?.convertFromPixel({ seriesIndex: 0 }, [x, y]) ?? [0, 0];
    const startPrice = Number(startValues[1]);
    const endPrice = Number(endValues[1]);
    const startTime = roundTF(Number(startValues[0]));
    const endTime = roundTF(Number(endValues[0]));
    const timeDiff = Math.abs(startTime - endTime);
    const xr = chartRef.value?.convertToPixel({ seriesIndex: 0 }, [endTime, 0])[0] ?? 0;
    const timeElapsed = humanizeDuration(timeDiff, { units: ['d', 'h', 'm'], round: true });
    const pctRaw = ((endPrice - startPrice) / startPrice) * 100;
    const pct = pctRaw.toFixed(2);
    const barCount = Math.round(timeDiff / timeframe_ms.value);
    const isPositive = pctRaw >= 0;

    // Dynamic colors
    const areaColor = isPositive
      ? 'rgba(38, 166, 154, 0.08)'
      : 'rgba(239, 83, 80, 0.08)';
    const lineColor = isPositive
      ? 'rgba(38, 166, 154, 0.3)'
      : 'rgba(239, 83, 80, 0.3)';
    const pillColor = isPositive
      ? 'rgba(38, 166, 154, 0.92)'
      : 'rgba(239, 83, 80, 0.92)';
    const pillShadow = isPositive
      ? 'rgba(38, 166, 154, 0.3)'
      : 'rgba(239, 83, 80, 0.3)';

    // Area rectangle
    const areaX = Math.min(startPos.value.x, xr);
    const areaW = Math.abs(xr - startPos.value.x);
    const areaY = Math.min(startPos.value.y, y);
    const areaH = Math.abs(y - startPos.value.y);

    // Label position — centered horizontally, above or below end point
    const labelX = areaX + areaW / 2 - labelW / 2;
    const labelY = y < startPos.value.y ? y - labelH - 6 : y + 6;

    chartRef.value?.setOption({
      graphic: [
        {
          id: 'pct-area',
          shape: { x: areaX, width: areaW, y: areaY, height: areaH },
          style: { fill: areaColor },
        },
        {
          id: 'pct-line-start',
          shape: { x1: startPos.value.x, y1: areaY, x2: startPos.value.x, y2: areaY + areaH },
          style: { stroke: lineColor },
        },
        {
          id: 'pct-line-end',
          shape: { x1: xr, y1: areaY, x2: xr, y2: areaY + areaH },
          style: { stroke: lineColor },
        },
        {
          id: 'pct-hline',
          shape: { x1: startPos.value.x, y1: y, x2: xr, y2: y },
          style: { stroke: lineColor },
        },
        {
          id: 'pct-label',
          shape: { x: labelX, y: labelY },
          style: {
            fill: pillColor,
            shadowColor: pillShadow,
          },
          textContent: {
            style: {
              text: `${barCount} bars  |  ${isPositive ? '+' : ''}${pct}%  |  ${timeElapsed}`,
            },
          },
        },
      ],
    });

    canDraw.value = false;
    setTimeout(() => {
      canDraw.value = true;
    }, 1000 / drawLimitPerSecond);
  }

  watch(
    () => inputListener.value,
    () => {
      if (inputListener.value && !active.value) {
        chartRef.value?.chart?.getZr().on('mousedown', mouseDown);
      }
    },
  );
}

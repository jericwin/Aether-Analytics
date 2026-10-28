import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { type MutableRefObject, useEffect, useRef } from "react";

echarts.use([BarChart, LineChart, PieChart, ScatterChart, BoxplotChart, HeatmapChart, GridComponent, TooltipComponent,
  LegendComponent, DataZoomComponent, VisualMapComponent, CanvasRenderer]);

export type EChartsOption = echarts.EChartsCoreOption;
export type EChartsInstance = echarts.ECharts;

interface Props {
  option: EChartsOption;
  onClick?: (params: { name?: string; seriesName?: string; data?: unknown; value?: unknown }) => void;
  ariaLabel: string;
  className?: string;
  /** Receives the ECharts instance (e.g. for PNG export). */
  chartRef?: MutableRefObject<echarts.ECharts | null>;
}

/** Thin ECharts wrapper: resizes with its container and re-applies options on change. */
export function EChart({ option, onClick, ariaLabel, className, chartRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    if (chartRef) chartRef.current = instance;
    instance.on("click", (p) => clickRef.current?.(p as never));
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      instance.dispose();
      chart.current = null;
      if (chartRef) chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={className ?? "h-full w-full"} />;
}

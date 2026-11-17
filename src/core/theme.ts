// Drawing themes. Line widths are in CSS pixels (screen-space fat lines).
import type { ThemeName } from './types';

export interface ThemeTokens {
  name: ThemeName;
  /** Canvas background (solid) + vignette colour for the CSS gradient behind the canvas. */
  bg: string;
  bgVignette: string;
  /** Face fill used for hidden-line removal ("clean" mode): faces painted in near-bg colour. */
  fill: string;
  /** Face colour used when shadows / lighting are on. */
  litFill: string;
  /** Custom blocks get a slightly different fill + hatch tone. */
  blockFill: string;
  line: string;          // model edges
  lineSoft: string;      // inner edges (cell openings), hidden dashed edges
  info: string;          // dimension lines, labels
  infoMuted: string;     // extension lines
  gridMinor: string;
  gridMajor: string;
  axisX: string;
  axisY: string;
  axisZ: string;
  select: string;
  hover: string;
  ghostOk: string;
  ghostBad: string;
  shadowOpacity: number;
  widths: {
    model: number;       // outer silhouette / outer edges
    modelInner: number;  // cell opening edges
    hidden: number;      // dashed hidden edges (transparency)
    dim: number;         // dimension line
    ext: number;         // extension line
    gridMinor: number;
    gridMajor: number;
    axis: number;
    select: number;
  };
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  blueprint: {
    name: 'blueprint',
    bg: '#1a4a8c',
    bgVignette: '#123766',
    fill: '#1c4f94',
    litFill: '#3a6fb5',
    blockFill: '#21579e',
    line: '#ffffff',
    lineSoft: '#cfe0ff',
    info: '#e8f1ff',
    infoMuted: '#9fbde8',
    gridMinor: 'rgba(255,255,255,0.07)',
    gridMajor: 'rgba(255,255,255,0.18)',
    axisX: '#ff7a7a',
    axisY: '#7ef0a0',
    axisZ: '#7fd8ff',
    select: '#ffd166',
    hover: '#ffe9ad',
    ghostOk: '#9ff5c7',
    ghostBad: '#ff8a8a',
    shadowOpacity: 0.28,
    widths: { model: 2.2, modelInner: 1.3, hidden: 1, dim: 1, ext: 0.75, gridMinor: 1, gridMajor: 1, axis: 2, select: 3 },
  },
  paper: {
    name: 'paper',
    bg: '#f6f5f1',
    bgVignette: '#e9e7e0',
    fill: '#f6f5f1',
    litFill: '#ffffff',
    blockFill: '#eeece6',
    line: '#1d1d1f',
    lineSoft: '#55565b',
    info: '#0a5bd8',
    infoMuted: '#7c8aa5',
    gridMinor: 'rgba(0,0,0,0.05)',
    gridMajor: 'rgba(0,0,0,0.12)',
    axisX: '#e5484d',
    axisY: '#30a46c',
    axisZ: '#0090ff',
    select: '#ff9f0a',
    hover: '#ffc56b',
    ghostOk: '#30a46c',
    ghostBad: '#e5484d',
    shadowOpacity: 0.18,
    widths: { model: 2, modelInner: 1.2, hidden: 1, dim: 1, ext: 0.75, gridMinor: 1, gridMajor: 1, axis: 2, select: 3 },
  },
};

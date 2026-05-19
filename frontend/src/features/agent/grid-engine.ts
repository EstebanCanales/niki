import { GLYPHS, CELL_SIZE } from "./constants";
import type { Phase } from "./types";

type Dot = {
  x: number;
  y: number;
  z: number;
  lon: number;
  lat: number;
  seed: number;
  seed2: number;
};

const DOT_COUNT = 1200;
const CAMERA = 760;
const TAU = Math.PI * 2;
const dotCache = new Map<number, Dot[]>();

function fract(value: number) {
  return value - Math.floor(value);
}

function rotateY(x: number, y: number, z: number, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c + z * s, y, z: -x * s + z * c };
}

function rotateX(x: number, y: number, z: number, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x, y: y * c - z * s, z: y * s + z * c };
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function phaseColor(
  phase: Phase,
  sttListening: boolean,
  cellColor: [number, number, number],
): [number, number, number] {
  if (sttListening) return [255, 184, 74];
  switch (phase) {
    case "chatting":
      return [110, 205, 255];
    case "done":
      return [112, 230, 186];
    case "error":
      return [255, 116, 116];
    default:
      return cellColor;
  }
}

function getDots(radius: number) {
  const key = Math.round(radius);
  const cached = dotCache.get(key);
  if (cached) return cached;

  const dots: Dot[] = [];
  for (let i = 0; i < DOT_COUNT; i++) {
    const u = i / DOT_COUNT;
    const y = 1 - 2 * u;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (3 - Math.sqrt(5)) * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    dots.push({
      x: x * radius,
      y: y * radius,
      z: z * radius,
      lon: Math.atan2(z, x),
      lat: Math.asin(y),
      seed: fract(Math.sin(i * 91.173) * 43758.5453123),
      seed2: fract(Math.sin((i + 17) * 51.931) * 24634.63451),
    });
  }

  dotCache.set(key, dots);
  return dots;
}

function drawBitmapOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bitmap: boolean[][],
  reveal: number,
  color: [number, number, number],
  cellSize: number,
) {
  const rows = bitmap.length;
  const cols = bitmap[0]?.length ?? 0;
  if (!rows || !cols) return;

  const totalWidth = cols * cellSize;
  const totalHeight = rows * cellSize;
  const offsetX = (width - totalWidth) / 2;
  const offsetY = (height - totalHeight) / 2;
  const [r, g, b] = color;
  const t = smoothstep(0, 1, reveal);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!bitmap[row]?.[col]) continue;
      const x = offsetX + col * cellSize + cellSize * 0.5;
      const y = offsetY + row * cellSize + cellSize * 0.5;
      const size = cellSize * (0.24 + 0.28 * t);
      ctx.fillStyle = `rgba(${r},${g},${b},${0.28 + 0.62 * t})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
  }
}

export function buildDotMatrix(
  text: string,
  cols: number,
  rows: number,
): boolean[][] {
  const charW = 5;
  const charH = 5;
  const gap = 2;
  const maxChars = Math.max(1, Math.floor((cols + gap) / (charW + gap)));
  const chars = text.toUpperCase().slice(0, maxChars).split("");
  const bitmap = Array.from({ length: rows }, () => Array(cols).fill(false));
  const totalW = chars.length * charW + (chars.length - 1) * gap;
  const startCol = Math.max(0, Math.floor((cols - totalW) / 2));
  const startRow = Math.max(0, Math.floor((rows - charH) / 2));

  chars.forEach((ch, charIndex) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    const colOffset = startCol + charIndex * (charW + gap);
    for (let row = 0; row < charH; row++) {
      for (let col = 0; col < charW; col++) {
        const targetRow = startRow + row;
        const targetCol = colOffset + col;
        if (targetRow < rows && targetCol < cols) {
          bitmap[targetRow][targetCol] = glyph[row][col] === 1;
        }
      }
    }
  });

  return bitmap;
}

export function buildMultiLineBitmap(
  lines: string[],
  cols: number,
  rows: number,
  paddingLeft = 6,
  paddingTop = 6,
): boolean[][] {
  const charW = 5;
  const charH = 5;
  const gap = 2;
  const lineGap = 4;
  const bitmap = Array.from({ length: rows }, () => Array(cols).fill(false));

  lines.filter(Boolean).forEach((text, lineIdx) => {
    const chars = text
      .toUpperCase()
      .split("")
      .map((ch) => (GLYPHS[ch] ? ch : " "));
    const maxChars = Math.max(
      1,
      Math.floor((cols - paddingLeft + gap) / (charW + gap)),
    );
    const rowOffset = paddingTop + lineIdx * (charH + lineGap);

    chars.slice(0, maxChars).forEach((ch, ci) => {
      const glyph = GLYPHS[ch] ?? GLYPHS[" "];
      const colOffset = paddingLeft + ci * (charW + gap);
      for (let r = 0; r < charH; r++) {
        for (let c = 0; c < charW; c++) {
          const tr = rowOffset + r;
          const tc = colOffset + c;
          if (tr < rows && tc < cols) bitmap[tr][tc] = glyph[r][c] === 1;
        }
      }
    });
  });

  return bitmap;
}

export function buildCircleBitmap(
  cols: number,
  rows: number,
  radiusFraction = 0.38,
): boolean[][] {
  const bitmap = Array.from({ length: rows }, () => Array(cols).fill(false));
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const r = Math.min(cols, rows) * radiusFraction;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (Math.hypot(col - cx, row - cy) <= r) bitmap[row][col] = true;
    }
  }
  return bitmap;
}

export function buildBarChart(
  values: number[],
  cols: number,
  rows: number,
): boolean[][] {
  const bitmap = Array.from({ length: rows }, () => Array(cols).fill(false));
  const numBars = Math.min(values.length, cols);
  const slot = Math.max(1, Math.floor(cols / Math.max(numBars, 1)));
  const maxVal = Math.max(...values, 1);
  const chartHeight = rows - 2;

  for (let barIndex = 0; barIndex < numBars; barIndex++) {
    const barHeight = Math.round((values[barIndex] / maxVal) * chartHeight);
    const barWidth = Math.max(1, slot - 1);
    const colOffset = barIndex * slot;
    for (let row = 0; row < barHeight; row++) {
      for (let col = 0; col < barWidth; col++) {
        const targetCol = colOffset + col;
        const targetRow = rows - 2 - row;
        if (targetRow >= 0 && targetCol < cols)
          bitmap[targetRow][targetCol] = true;
      }
    }
  }

  return bitmap;
}

export function drawAgentGrid(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  frame: number,
  phase: Phase,
  sttListening: boolean,
  gridBitmap: boolean[][] | null,
  menuOpen: boolean,
  bitmapReveal: number,
  exitProgress: number,
  cellColor: [number, number, number],
  cs: number = CELL_SIZE,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const [r, g, b] = phaseColor(phase, sttListening, cellColor);
  const cx = width / 2;
  const cy = height / 2 - Math.min(28, height * 0.04);
  const visibility = Math.max(0.15, Math.min(1, exitProgress));
  const radius = Math.min(width, height) * (menuOpen ? 0.18 : 0.23);
  const loopProgress = frame / 720;

  const background = ctx.createRadialGradient(
    cx,
    cy,
    radius * 0.12,
    cx,
    cy,
    radius * 1.85,
  );
  background.addColorStop(0, `rgba(${r},${g},${b},${0.14 * visibility})`);
  background.addColorStop(0.45, "rgba(10,18,30,0.18)");
  background.addColorStop(1, "rgba(3,7,13,0)");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const dots = getDots(radius);
  const rotYAngle = TAU * loopProgress;
  const rotXAngle = 0.35 * Math.sin(TAU * loopProgress);
  const rendered: Array<{
    x: number;
    y: number;
    z: number;
    scale: number;
    alpha: number;
    size: number;
    glow: number;
  }> = [];

  for (const dot of dots) {
    let pt = rotateY(dot.x, dot.y, dot.z, rotYAngle);
    pt = rotateX(pt.x, pt.y, pt.z, rotXAngle);

    const scale = CAMERA / (CAMERA - pt.z);
    const x = cx + pt.x * scale;
    const y = cy + pt.y * scale;
    const depthNorm = (pt.z + radius) / (2 * radius);
    const baseAlpha = (0.18 + depthNorm * 0.78) * visibility;
    const baseSize = 0.8 + depthNorm * 2.5;
    const waveA =
      1 -
      Math.min(
        1,
        Math.abs(
          Math.sin(2.1 * dot.lon - TAU * loopProgress + dot.seed * 0.8),
        ) / 0.16,
      );
    const waveB =
      1 -
      Math.min(
        1,
        Math.abs(
          Math.sin(1.35 * dot.lat + 1.25 * dot.lon + TAU * loopProgress * 1.35),
        ) / 0.2,
      );
    const band =
      1 -
      Math.min(1, Math.abs(Math.sin(dot.lat * 4 - TAU * loopProgress)) / 0.11);
    const spark = Math.pow(
      Math.max(waveA, waveB, band),
      phase === "chatting" ? 1.5 : 1.25,
    );
    const flicker =
      0.72 + 0.28 * Math.sin(TAU * loopProgress * 2 + dot.seed2 * TAU);
    rendered.push({
      x,
      y,
      z: pt.z,
      scale,
      alpha: Math.min(1, baseAlpha * flicker + spark * 0.82),
      size: baseSize + spark * (phase === "chatting" ? 3.8 : 2.8),
      glow: spark,
    });
  }

  rendered.sort((a, b) => a.z - b.z);
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (const dot of rendered) {
    const rad = dot.size * dot.scale;
    if (dot.glow > 0.06) {
      const glow = ctx.createRadialGradient(
        dot.x,
        dot.y,
        0,
        dot.x,
        dot.y,
        rad * 4.8,
      );
      glow.addColorStop(0, `rgba(${r},${g},${b},${0.18 * dot.glow})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, rad * 4.8, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(${Math.min(255, r + 36)},${Math.min(255, g + 24)},${Math.min(255, b + 12)},${dot.alpha})`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, rad, 0, TAU);
    ctx.fill();
  }

  ctx.restore();

  if (gridBitmap && bitmapReveal > 0) {
    drawBitmapOverlay(
      ctx,
      width,
      height,
      gridBitmap,
      bitmapReveal,
      [r, g, b],
      Math.max(8, cs * 0.72),
    );
  }
}

'use strict';

const DEFAULTS = {
  id: 'nord-bluish',
  name: 'Nord Bluish',
  description: 'Slate blue glass with cyan accents',
  mode: 'transparent',
  nativeTransparency: true,
  acrylic: true,
  opacity: 1,
  colors: {
    background: '#2e344000',
    panel: '#2e3440cc',
    raised: '#3b4252b3',
    sunken: '#242933b3',
    interactive: '#434c5e99',
    text: '#eceff4',
    muted: '#8b95a7',
    strong: '#ffffff',
    border: '#4c566a73',
    subtle: '#434c5e4d',
    focus: '#88c0d0',
    accent: '#81a1c1',
    success: '#a3be8c',
    warning: '#ebcb8b',
    error: '#bf616a'
  },
  layout: {
    density: 'comfortable',
    sidebarWidth: 260,
    borderRadius: 10,
    fontScale: 1,
    customCss: ''
  },
  blur: {
    mode: 'acrylic',
    radius: 18,
    panels: true,
    scrim: 35,
    saturation: 140
  }
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function number(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function color(value, fallback) {
  if (typeof value !== 'string') return fallback;
  if (value === 'transparent') return value;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value + 'ff';
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value;
  const m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(value);
  if (m) {
    const byte = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
    const alpha = m[4] === undefined ? 255 : Math.max(0, Math.min(255, Math.round(Number(m[4]) * 255)));
    return '#' + byte(m[1]) + byte(m[2]) + byte(m[3]) + byte(alpha);
  }
  return fallback;
}

function normalize(input) {
  const out = cloneDefaults();
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  out.id = typeof src.id === 'string' && /^[a-z0-9._-]{1,64}$/i.test(src.id) ? src.id : out.id;
  out.name = typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 80) : out.name;
  out.description = typeof src.description === 'string' ? src.description.slice(0, 240) : out.description;
  out.mode = ['transparent', 'acrylic', 'opaque'].includes(src.mode) ? src.mode : out.mode;
  out.nativeTransparency = src.nativeTransparency !== false;
  out.acrylic = src.acrylic !== false;
  out.opacity = number(src.opacity, 1, 0.2, 1);
  const source = src.colors && typeof src.colors === 'object' ? src.colors : {};
  const aliases = {
    background: ['--v2-background-bg-deep', '--v2-background-bg-base'],
    panel: ['--v2-background-surface-base', '--v2-background-bg-layer-01'],
    raised: ['--v2-background-surface-raised', '--v2-background-bg-layer-02'],
    sunken: ['--v2-background-surface-sunken', '--v2-background-bg-layer-03'],
    interactive: ['--v2-background-interactive-base', '--v2-overlay-simple-overlay-hover'],
    text: ['--v2-text-text-base'],
    muted: ['--v2-text-text-muted', '--v2-text-text-weak'],
    strong: ['--v2-text-text-contrast', '--v2-text-text-strong'],
    border: ['--v2-border-border-base'],
    subtle: ['--v2-border-border-weak'],
    focus: ['--v2-border-border-focus', '--v2-border-focus'],
    accent: ['--v2-icon-icon-accent', '--v2-icon-icon-base'],
    success: ['--v2-state-fg-success'],
    warning: ['--v2-state-fg-warning'],
    error: ['--v2-state-fg-danger']
  };
  for (const key of Object.keys(out.colors)) {
    out.colors[key] = color(source[key], out.colors[key]);
    for (const alias of aliases[key] || []) out.colors[key] = color(source[alias], out.colors[key]);
  }
  const layout = src.layout && typeof src.layout === 'object' ? src.layout : {};
  out.layout.density = layout.density === 'compact' ? 'compact' : 'comfortable';
  out.layout.sidebarWidth = number(layout.sidebarWidth, out.layout.sidebarWidth, 180, 420);
  out.layout.borderRadius = number(layout.borderRadius, out.layout.borderRadius, 0, 24);
  out.layout.fontScale = number(layout.fontScale, 1, 0.8, 1.3);
  out.layout.customCss = typeof layout.customCss === 'string' ? layout.customCss.slice(0, 50000) : '';

  const blur = src.blur && typeof src.blur === 'object' && !Array.isArray(src.blur) ? src.blur : {};
  out.blur.mode = ['none', 'acrylic', 'mica', 'gaussian'].includes(blur.mode) ? blur.mode : out.blur.mode;
  out.blur.radius = number(blur.radius, out.blur.radius, 0, 64);
  out.blur.panels = blur.panels !== false;
  out.blur.scrim = number(blur.scrim, out.blur.scrim, 0, 90);
  out.blur.saturation = number(blur.saturation, out.blur.saturation, 100, 200);
  return out;
}

function rgba(hex) {
  const value = color(hex, '#00000000');
  if (value === 'transparent') return 'transparent';
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  const a = parseInt(value.slice(7, 9), 16) / 255;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(4))})`;
}

function fade(hex, alpha) {
  const value = color(hex, '#00000000');
  if (value === 'transparent') return 'transparent';
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(4))})`;
}

function generateCss(themeInput) {
  const theme = normalize(themeInput);
  const c = theme.colors;
  const l = theme.layout;
  const opaque = theme.mode === 'opaque';
  const bg = opaque ? rgba(c.panel) : rgba(c.background);
  const layers = [c.panel, c.raised, c.sunken, c.raised];
  const b = theme.blur;
  const radius = b.radius;
  const sat = b.saturation;
  const scrim = b.scrim / 100;

  const blurValue = b.mode === 'gaussian' ? `blur(${radius}px) saturate(${sat}%)` : `blur(${Math.round(radius / 2)}px) saturate(${sat}%)`;
  const panelBlur = !b.panels || b.mode === 'none'
    ? ''
    : `[data-slot="sidebar"], aside, nav, [data-slot="card"], [role="dialog"], [data-slot="popover-content"] {
  backdrop-filter: ${blurValue};
  -webkit-backdrop-filter: ${blurValue};
  box-shadow: inset 0 1px 0 ${fade(c.strong, 0.07)};
}
html::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background: ${fade(c.background, scrim)};
}
@media (prefers-reduced-transparency: reduce) {
  [data-slot="sidebar"], aside, nav, [data-slot="card"], [role="dialog"], [data-slot="popover-content"] {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background-color: ${rgba(c.panel)} !important;
  }
  html::before { background: ${rgba(c.panel)}; }
}`;
  return `/* Generated by OpenCode Theme Studio. */
:root {
  --v2-background-bg-deep: ${bg};
  --v2-background-bg-layer-01: ${rgba(layers[0])};
  --v2-background-bg-layer-02: ${rgba(layers[1])};
  --v2-background-bg-layer-03: ${rgba(layers[2])};
  --v2-background-bg-layer-04: ${rgba(layers[3])};
  --v2-background-bg-contrast: ${rgba(c.strong)};
  --v2-background-bg-inverse: ${rgba(c.text)};
  --v2-background-bg-icon-button-contrast: ${rgba(c.panel)};
  --v2-text-text-base: ${rgba(c.text)};
  --v2-text-text-muted: ${rgba(c.muted)};
  --v2-text-text-contrast: ${rgba(c.strong)};
  --v2-text-text-faint: ${rgba(c.muted)};
  --v2-text-text-inverse: ${rgba(c.background)};
  --v2-text-text-accent: ${rgba(c.focus)};
  --v2-text-text-accent-hover: ${rgba(c.focus)};
  --v2-text-text-code-accent: ${rgba(c.focus)};
  --v2-text-text-code-path: ${rgba(c.muted)};
  --v2-border-border-base: ${rgba(c.border)};
  --v2-border-border-weak: ${rgba(c.subtle)};
  --v2-border-border-strong: ${rgba(c.border)};
  --v2-border-border-muted: ${rgba(c.subtle)};
  --v2-border-border-inverse: ${rgba(c.text)};
  --v2-border-border-focus: ${rgba(c.focus)};
  --v2-icon-icon-base: ${rgba(c.text)};
  --v2-icon-icon-muted: ${rgba(c.muted)};
  --v2-icon-icon-faint: ${rgba(c.muted)};
  --v2-icon-icon-contrast: ${rgba(c.strong)};
  --v2-icon-icon-accent: ${rgba(c.focus)};
  --v2-icon-icon-accent-hover: ${rgba(c.focus)};
  --v2-icon-icon-inverse: ${rgba(c.background)};
  --v2-state-fg-success: ${rgba(c.success)};
  --v2-state-fg-warning: ${rgba(c.warning)};
  --v2-state-fg-danger: ${rgba(c.error)};
  --v2-state-fg-info: ${rgba(c.focus)};
  --v2-state-bg-success: ${fade(c.success, 0.16)};
  --v2-state-bg-warning: ${fade(c.warning, 0.16)};
  --v2-state-bg-danger: ${fade(c.error, 0.16)};
  --v2-state-bg-info: ${fade(c.focus, 0.16)};
  --v2-state-border-success: ${fade(c.success, 0.32)};
  --v2-state-border-warning: ${fade(c.warning, 0.32)};
  --v2-state-border-danger: ${fade(c.error, 0.32)};
  --v2-state-border-info: ${fade(c.focus, 0.32)};
  --v2-overlay-simple-overlay-hover: ${rgba(c.interactive)};
  --v2-overlay-simple-overlay-pressed: ${rgba(c.panel)};
  --v2-overlay-simple-overlay-scrim: ${fade(c.background, 0.55)};
  --v2-overlay-simple-tab-scrim: ${fade(c.background, 0.35)};
  --v2-overlay-simple-tab-active-scrim: ${fade(c.panel, 0.55)};
  --v2-overlay-simple-tab-hover-scrim: ${fade(c.interactive, 0.35)};
  --ots-panel: ${rgba(c.panel)};
  --ots-radius: ${l.borderRadius}px;
  --ots-font-scale: ${l.fontScale};
}
html, body, #root {
  background: ${bg} !important;
}
body {
  font-size: calc(14px * ${l.fontScale});
}
[data-slot="sidebar"], aside, nav {
  background-color: ${rgba(c.panel)} !important;
  border-color: ${rgba(c.border)} !important;
}
[data-slot="card"], [role="dialog"], [data-slot="popover-content"] {
  border-radius: var(--ots-radius);
}
${panelBlur}
${l.density === 'compact' ? `[data-slot="sidebar"] { width: ${l.sidebarWidth}px; }
button, input, textarea { min-height: 28px; }` : ''}
${l.customCss}
`;
}

module.exports = { DEFAULTS, cloneDefaults, normalize, rgba, generateCss };

// Renders the app icons in public/icons from one SVG. Run: node scripts/generate-icons.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const BG = "#15110e";
const ACCENT = "#f2a65a";

// A simple sofa: back, seat and two arms. `scale` shrinks it for the maskable safe zone.
const svg = (scale = 1, radius = 0) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${BG}"/>
  <g transform="translate(256 270) scale(${scale}) translate(-256 -270)" fill="${ACCENT}">
    <rect x="136" y="150" width="240" height="120" rx="36"/>
    <rect x="96" y="214" width="72" height="150" rx="32"/>
    <rect x="344" y="214" width="72" height="150" rx="32"/>
    <rect x="150" y="262" width="212" height="86" rx="22" fill="#e08f42"/>
    <rect x="124" y="352" width="28" height="44" rx="10"/>
    <rect x="360" y="352" width="28" height="44" rx="10"/>
  </g>
</svg>`;

const out = new URL("../public/icons/", import.meta.url);
await mkdir(out, { recursive: true });

const jobs = [
  ["icon-192.png", 192, svg(1, 96)],
  ["icon-512.png", 512, svg(1, 112)],
  ["maskable-512.png", 512, svg(0.72)],
  ["apple-touch-icon.png", 180, svg(0.92)],
  ["favicon-32.png", 32, svg(1.05, 96)],
];

for (const [name, size, source] of jobs) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(new URL(name, out).pathname);
  console.log("wrote", name);
}

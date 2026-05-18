import sharp from "sharp";

const items = [
  { src: "/tmp/logo-stacked.png", out: "src/assets/resistact-logo-stacked.webp" },
  { src: "/tmp/logo-horizontal.png", out: "src/assets/resistact-logo-horizontal.webp" },
];

for (const { src, out } of items) {
  await sharp(src)
    .trim({ background: { r: 255, g: 255, b: 255 }, threshold: 5 })
    .webp({ quality: 92 })
    .toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${out} → ${meta.width}×${meta.height}`);
}

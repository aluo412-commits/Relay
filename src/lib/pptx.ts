import PptxGenJS from "pptxgenjs";
import type { PresentationSpec, SlideSpec } from "./types";

// Relay deck palette (hex, no '#').
const INK = "14161A";
const TEXT = "EDEDE8";
const ACCENT = "E0662A";
const BLUE = "549AE0";
const MUTED = "9AA2B2";
const FAINT = "5A6270";
const FONT = "Arial";

function footer(slide: PptxGenJS.Slide, n: number) {
  slide.addText(
    [
      { text: "RELAY", options: { bold: true, color: FAINT } },
      { text: "   ·   Chat is for people, work runs on Relay", options: { color: FAINT } },
    ],
    { x: 0.6, y: 7.02, w: 9, h: 0.35, fontSize: 9, fontFace: FONT, valign: "middle" }
  );
  slide.addText(String(n).padStart(2, "0"), {
    x: 11.8, y: 7.02, w: 0.95, h: 0.35, fontSize: 9, bold: true, color: FAINT, align: "right", fontFace: FONT, valign: "middle",
  });
}

function bar(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color: string) {
  slide.addText("", { x, y, w, h, fill: { color } });
}

function titleSlide(pptx: PptxGenJS, s: SlideSpec): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: INK };
  bar(slide, 0.9, 2.35, 0.9, 0.14, ACCENT);
  slide.addText(s.title, { x: 0.85, y: 2.55, w: 11.5, h: 1.5, fontSize: 72, bold: true, color: TEXT, fontFace: FONT });
  if (s.subtitle) {
    slide.addText(s.subtitle, { x: 0.9, y: 4.15, w: 11.5, h: 0.9, fontSize: 28, bold: true, color: ACCENT, fontFace: FONT });
  }
  if (s.bullets.length) {
    slide.addText(s.bullets.join("   ·   "), { x: 0.9, y: 5.05, w: 11, h: 0.9, fontSize: 17, color: MUTED, fontFace: FONT });
  }
  return slide;
}

function contentSlide(pptx: PptxGenJS, s: SlideSpec, n: number, accent: string): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: INK };
  bar(slide, 0.6, 0.78, 0.55, 0.09, accent);
  slide.addText(s.title.toUpperCase(), { x: 0.6, y: 0.95, w: 11.5, h: 0.4, fontSize: 12, bold: true, color: accent, fontFace: FONT });
  slide.addText(s.subtitle || s.title, {
    x: 0.58, y: 1.3, w: 12, h: 1.1, fontSize: 34, bold: true, color: TEXT, fontFace: FONT, valign: "top",
  });
  if (s.bullets.length) {
    slide.addText(
      s.bullets.map((b) => ({
        text: b,
        options: { bullet: { characterCode: "2014" }, color: TEXT, indentLevel: 0 },
      })),
      { x: 0.7, y: 2.7, w: 12.0, h: 3.7, fontSize: 16, color: TEXT, fontFace: FONT, lineSpacingMultiple: 1.1, paraSpaceAfter: 12, valign: "top" }
    );
  }
  footer(slide, n);
  return slide;
}

/** Render an agent-authored presentation into a real .pptx, returned as base64. */
export async function buildPptxBase64(pres: PresentationSpec): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "RELAY_WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "RELAY_WIDE";
  pptx.author = "Relay";
  pptx.title = pres.title;

  pres.slides.forEach((s, i) => {
    const slide =
      i === 0 && (s.subtitle || s.bullets.length <= 2)
        ? titleSlide(pptx, s)
        : contentSlide(pptx, s, i + 1, i % 2 === 0 ? ACCENT : BLUE);
    if (s.notes) slide.addNotes(s.notes);
  });

  return (await pptx.write({ outputType: "base64" })) as string;
}

/** A readable markdown preview of the deck for the in-app artifact window. */
export function presentationMarkdown(pres: PresentationSpec): string {
  const parts: string[] = [`# ${pres.title}`, `*${pres.slides.length} slides · ${pres.filename}*`, ""];
  pres.slides.forEach((s, i) => {
    parts.push(`## ${i + 1}. ${s.title}`);
    if (s.subtitle) parts.push(`*${s.subtitle}*`);
    for (const b of s.bullets) parts.push(`- ${b}`);
    parts.push("");
  });
  return parts.join("\n").trim();
}

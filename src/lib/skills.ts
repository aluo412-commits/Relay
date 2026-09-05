// Built-in capabilities available to Relay's execution layer.
// Skills are deliberately allow-listed: the model may use these capabilities, but
// cannot install arbitrary packages or execute arbitrary shell commands.

export interface RelaySkill {
  id: string;
  name: string;
  description: string;
  handles: string[];
  automatic: boolean;
}

export const BUILTIN_SKILLS: RelaySkill[] = [
  {
    id: "pdf-inspection",
    name: "PDF inspection",
    description: "Extract PDF text, render scanned pages, and OCR English documents.",
    handles: ["application/pdf", ".pdf"],
    automatic: true,
  },
  {
    id: "image-ocr",
    name: "Image OCR",
    description: "Read text from screenshots and scanned images.",
    handles: ["image/*"],
    automatic: true,
  },
];

/** Prompt-visible capability contract. Keep this explicit so the agent does not
 * reject a task merely because the user uploaded a PDF or image. */
export function capabilityContext(): string {
  return `\n\nAVAILABLE EXECUTION SKILLS\n- PDF inspection (automatic): PDFs are readable through embedded-text extraction; scanned PDFs fall back to page rendering + English OCR.\n- Image OCR (automatic): screenshots and scanned images can be OCR'd.\nThe agent must try the relevant built-in skill before saying it cannot inspect a file. Never claim a PDF is unreadable solely because it is a PDF. If extraction genuinely returns no useful text, explain what was attempted and ask for a specific alternative (page image, text layer, or a different file). Third-party skills and arbitrary code execution are not installed without explicit user approval.`;
}

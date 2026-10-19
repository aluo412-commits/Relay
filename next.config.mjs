import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // Prisma needs to be treated as an external package in server components / route handlers
  serverExternalPackages: ["@prisma/client", "prisma", "unpdf", "tesseract.js", "@napi-rs/canvas"],
};

export default nextConfig;

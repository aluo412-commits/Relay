/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prisma needs to be treated as an external package in server components / route handlers
  serverExternalPackages: ["@prisma/client", "prisma", "unpdf", "tesseract.js", "@napi-rs/canvas"],
};

export default nextConfig;

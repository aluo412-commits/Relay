import type { Metadata } from "next";
import StudentAccountGate from "@/components/student/StudentAccountGate";
import "@/components/student/student.css";
import "@/components/student/reader.css";
import "@/components/student/reader-brief.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Relay — Your school day, in view",
  description: "Your assignments, school updates and upcoming dates, together in one calm workspace. For FUHSD and Palo Alto Unified students.",
  openGraph: {
    title: "Relay — Your school day, in view",
    description: "Less checking everywhere. More knowing what’s next.",
    type: "website",
  },
};
export default function Page() {
  return <StudentAccountGate initialNow={new Date().toISOString()} />;
}

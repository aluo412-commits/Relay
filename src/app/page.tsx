import type { Metadata } from "next";
import StudentDashboard from "@/components/student/StudentDashboard";
import "@/components/student/student.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Relay — Your school day, in view",
  description: "Your assignments, school updates and upcoming dates, together in one calm workspace. Starting with FUHSD.",
  openGraph: {
    title: "Relay — Your school day, in view",
    description: "Less checking everywhere. More knowing what’s next.",
    type: "website",
  },
};
export default function Page() {
  return <StudentDashboard initialNow={new Date().toISOString()} />;
}

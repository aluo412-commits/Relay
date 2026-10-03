import type { Metadata } from "next";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "Relay — chat is for people, work runs on Relay",
  description:
    "Relay is AI-native team coordination. Log work in plain language and its agent turns it into structured, shared, up-to-date tasks, records, and knowledge — so nobody files a status report again.",
  openGraph: {
    title: "Relay — chat is for people, work runs on Relay",
    description:
      "Log work in plain language. Relay's agent turns it into structured, shared work — tasks, records, knowledge — kept true without upkeep.",
    type: "website",
  },
};

export default function Page() {
  return <Landing />;
}

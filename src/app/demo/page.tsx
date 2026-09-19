import RelayApp from "@/components/RelayApp";
import "./demo.css";

// The production UI with an instance-local scripted transport. No auth or seeding.
export default function DemoPage() {
  return <RelayApp demoMode />;
}

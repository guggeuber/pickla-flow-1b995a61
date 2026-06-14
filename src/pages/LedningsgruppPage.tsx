import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function LedningsgruppPage() {
  return <EventLandingPage config={getEventLandingConfig("ledningsgrupp-stockholm")!} />;
}

import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function JubileumPage() {
  return <EventLandingPage config={getEventLandingConfig("jubileum-stockholm")!} />;
}

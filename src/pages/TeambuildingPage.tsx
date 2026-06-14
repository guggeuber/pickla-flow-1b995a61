import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function TeambuildingPage() {
  return <EventLandingPage config={getEventLandingConfig("teambuilding-stockholm")!} />;
}

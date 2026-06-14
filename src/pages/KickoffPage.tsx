import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function KickoffPage() {
  return <EventLandingPage config={getEventLandingConfig("kickoff-stockholm")!} />;
}

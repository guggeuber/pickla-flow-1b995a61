import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function SkolavslutningPage() {
  return <EventLandingPage config={getEventLandingConfig("skolavslutning-stockholm")!} />;
}

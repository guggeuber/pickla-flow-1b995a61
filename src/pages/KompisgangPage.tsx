import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function KompisgangPage() {
  return <EventLandingPage config={getEventLandingConfig("kompisgang-stockholm")!} />;
}

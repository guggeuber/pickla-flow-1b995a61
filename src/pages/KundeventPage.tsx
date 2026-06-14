import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function KundeventPage() {
  return <EventLandingPage config={getEventLandingConfig("kundevent-stockholm")!} />;
}

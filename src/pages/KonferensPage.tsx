import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function KonferensPage() {
  return <EventLandingPage config={getEventLandingConfig("konferens-stockholm")!} />;
}

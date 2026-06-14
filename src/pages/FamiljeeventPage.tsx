import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function FamiljeeventPage() {
  return <EventLandingPage config={getEventLandingConfig("familjeevent-stockholm")!} />;
}

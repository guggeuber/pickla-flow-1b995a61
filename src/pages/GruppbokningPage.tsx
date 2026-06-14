import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function GruppbokningPage() {
  return <EventLandingPage config={getEventLandingConfig("gruppbokning-stockholm")!} />;
}

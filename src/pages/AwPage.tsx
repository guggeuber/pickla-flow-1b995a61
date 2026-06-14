import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function AwPage() {
  return <EventLandingPage config={getEventLandingConfig("aw-stockholm")!} />;
}

import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function ForetagseventPage() {
  return <EventLandingPage config={getEventLandingConfig("foretagsevent-stockholm")!} />;
}

import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function EventlokalerPage() {
  const cfg = getEventLandingConfig("eventlokaler")!;
  return <EventLandingPage config={cfg} />;
}

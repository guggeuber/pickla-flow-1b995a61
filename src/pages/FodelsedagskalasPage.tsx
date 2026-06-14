import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function FodelsedagskalasPage() {
  return <EventLandingPage config={getEventLandingConfig("fodelsedagskalas-stockholm")!} />;
}

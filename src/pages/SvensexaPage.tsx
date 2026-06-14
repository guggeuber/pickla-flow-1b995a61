import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function SvensexaPage() {
  return <EventLandingPage config={getEventLandingConfig("svensexa-stockholm")!} />;
}

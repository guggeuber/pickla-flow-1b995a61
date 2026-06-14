import EventLandingPage from "@/components/EventLandingPage";
import { getEventLandingConfig } from "@/config/eventLandingPages";

export default function MohippaPage() {
  return <EventLandingPage config={getEventLandingConfig("mohippa-stockholm")!} />;
}

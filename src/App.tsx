import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { Location as RouterLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { Analytics } from "@vercel/analytics/react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import EventOps from "./pages/EventOps";
import AdminPage from "./pages/AdminPage";
import AdminEventLeadsPage from "./pages/AdminEventLeadsPage";
import AdminEventProductsPage from "./pages/AdminEventProductsPage";
import HubPage from "./pages/HubPage";
import HotellPage from "./pages/HotellPage";
import Auth from "./pages/Auth";
import MyPage from "./pages/MyPage";
import CommunityPage from "./pages/CommunityPage";
import PlayPage from "./pages/PlayPage";
import EventsListPage from "./pages/EventsListPage";
import OpenPlayPage from "./pages/OpenPlayPage";
import TodayPage from "./pages/TodayPage";
import ProgramSessionPage from "./pages/ProgramSessionPage";
import EventPage from "./pages/EventPage";
import EventPlanPublic from "./pages/EventPlanPublic";
import BookingPage from "./pages/BookingPage";
import GroupBookingPage from "./pages/GroupBookingPage";
import EventlokalerPage from "./pages/EventlokalerPage";
import ForetagseventPage from "./pages/ForetagseventPage";
import KickoffPage from "./pages/KickoffPage";
import AwPage from "./pages/AwPage";
import KonferensPage from "./pages/KonferensPage";
import TeambuildingPage from "./pages/TeambuildingPage";
import KundeventPage from "./pages/KundeventPage";
import LedningsgruppPage from "./pages/LedningsgruppPage";
import GruppbokningPage from "./pages/GruppbokningPage";
import FodelsedagskalasPage from "./pages/FodelsedagskalasPage";
import SvensexaPage from "./pages/SvensexaPage";
import MohippaPage from "./pages/MohippaPage";
import FamiljeeventPage from "./pages/FamiljeeventPage";
import KompisgangPage from "./pages/KompisgangPage";
import SkolavslutningPage from "./pages/SkolavslutningPage";
import JubileumPage from "./pages/JubileumPage";
import BookingConfirmation from "./pages/BookingConfirmation";
import BookingConfirmed from "./pages/BookingConfirmed";
import MembershipPage from "./pages/MembershipPage";
import MembershipConfirmed from "./pages/MembershipConfirmed";
import ReceiptPage from "./pages/ReceiptPage";
import WellnessCertificatePage from "./pages/WellnessCertificatePage";
import ClaimPassPage from "./pages/ClaimPassPage";
import LegalPage from "./pages/LegalPage";
import CorporateJoinPage from "./pages/CorporateJoinPage";
import CorporateDashboard from "./pages/CorporateDashboard";
import CorporateRegisterPage from "./pages/CorporateRegisterPage";
import VenueDisplay from "./pages/VenueDisplay";
import OpenPlayDisplay from "./pages/OpenPlayDisplay";
import ResourceCheckinDisplay from "./pages/ResourceCheckinDisplay";
import DeviceDisplay from "./pages/DeviceDisplay";
import ScoreStartPage from "./pages/ScoreStartPage";
import ScoreJoinPage from "./pages/ScoreJoinPage";
import ScoreMatchPage from "./pages/ScoreMatchPage";
import ScoreBroadcastPage from "./pages/ScoreBroadcastPage";
import StatsPage from "./pages/StatsPage";
import OpsCenterPage from "./pages/OpsCenterPage";
import AuthCallback from "./pages/AuthCallback";
import AuthReset from "./pages/AuthReset";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const REDIRECT_KEY = "pickla_auth_redirect";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    sessionStorage.setItem(REDIRECT_KEY, window.location.pathname + window.location.search);
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
};

function AppRoutes() {
  const location = useLocation();
  const state = location.state as { backgroundLocation?: RouterLocation } | null;
  const backgroundLocation = state?.backgroundLocation;

  return (
    <>
          <Routes location={backgroundLocation || location}>
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/reset" element={<AuthReset />} />
            <Route path="/" element={<TodayPage />} />
            <Route path="/desk" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/hub" element={<HubPage />} />
            <Route path="/hub/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            <Route path="/admin/event-leads" element={<ProtectedRoute><AdminEventLeadsPage /></ProtectedRoute>} />
            <Route path="/hub/admin/event-products" element={<ProtectedRoute><AdminEventProductsPage /></ProtectedRoute>} />
            <Route path="/admin/event-products" element={<ProtectedRoute><AdminEventProductsPage /></ProtectedRoute>} />
            <Route path="/ops" element={<ProtectedRoute><OpsCenterPage /></ProtectedRoute>} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/activity" element={<Navigate to="/today" replace />} />
            <Route path="/my" element={<MyPage />} />
            <Route path="/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/events" element={<EventsListPage />} />
            <Route path="/openplay" element={<OpenPlayPage />} />
            <Route path="/program/:sessionId" element={<ProgramSessionPage />} />
            <Route path="/event-ops" element={<ProtectedRoute><EventOps /></ProtectedRoute>} />
            <Route path="/event/:id" element={<EventPage />} />
            <Route path="/event-plan/:venueId" element={<EventPlanPublic />} />
            <Route path="/e/:slug" element={<EventPage />} />
            <Route path="/book" element={<BookingPage />} />
            <Route path="/book/group" element={<GroupBookingPage />} />
            <Route path="/eventlokaler" element={<EventlokalerPage />} />
            <Route path="/foretagsevent-stockholm" element={<ForetagseventPage />} />
            <Route path="/kickoff-stockholm" element={<KickoffPage />} />
            <Route path="/aw-stockholm" element={<AwPage />} />
            <Route path="/konferens-stockholm" element={<KonferensPage />} />
            <Route path="/teambuilding-stockholm" element={<TeambuildingPage />} />
            <Route path="/kundevent-stockholm" element={<KundeventPage />} />
            <Route path="/ledningsgrupp-stockholm" element={<LedningsgruppPage />} />
            <Route path="/gruppbokning-stockholm" element={<GruppbokningPage />} />
            <Route path="/fodelsedagskalas-stockholm" element={<FodelsedagskalasPage />} />
            <Route path="/svensexa-stockholm" element={<SvensexaPage />} />
            <Route path="/mohippa-stockholm" element={<MohippaPage />} />
            <Route path="/familjeevent-stockholm" element={<FamiljeeventPage />} />
            <Route path="/kompisgang-stockholm" element={<KompisgangPage />} />
            <Route path="/skolavslutning-stockholm" element={<SkolavslutningPage />} />
            <Route path="/jubileum-stockholm" element={<JubileumPage />} />
            <Route path="/hotell" element={<HotellPage />} />
            <Route path="/membership" element={<MembershipPage />} />
            <Route path="/membership/confirmed" element={<MembershipConfirmed />} />
            <Route path="/wellness" element={<WellnessCertificatePage />} />
            <Route path="/receipt/:ref" element={<ProtectedRoute><ReceiptPage /></ProtectedRoute>} />
            <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/terms" element={<LegalPage kind="terms" />} />
            <Route path="/cookies" element={<LegalPage kind="cookies" />} />
            <Route path="/b/:ref" element={<BookingConfirmation />} />
            <Route path="/booking/confirmed" element={<BookingConfirmed />} />
            <Route path="/booking-chat/:bookingRef" element={<HubPage />} />
            <Route path="/chat/:roomId" element={<HubPage />} />
            <Route path="/pass/:token" element={<ClaimPassPage />} />
            <Route path="/corp/join" element={<CorporateJoinPage />} />
            <Route path="/corp/register" element={<CorporateRegisterPage />} />
            <Route path="/corp/dashboard" element={<ProtectedRoute><CorporateDashboard /></ProtectedRoute>} />
            <Route path="/display/venue" element={<VenueDisplay />} />
            <Route path="/display/openplay" element={<OpenPlayDisplay />} />
            <Route path="/display/resource/:courtId" element={<ResourceCheckinDisplay />} />
            <Route path="/display/device/:token" element={<DeviceDisplay />} />
            <Route path="/display/broadcast/:scoreSessionId" element={<ScoreBroadcastPage />} />
            <Route path="/score/start" element={<ScoreStartPage />} />
            <Route path="/score/join" element={<ScoreJoinPage />} />
            <Route path="/score/match/:matchId" element={<ScoreMatchPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          {backgroundLocation && (
            <Routes>
              <Route path="/program/:sessionId" element={<ProgramSessionPage overlayOnly />} />
            </Routes>
          )}
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

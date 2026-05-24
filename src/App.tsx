import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import EventOps from "./pages/EventOps";
import AdminPage from "./pages/AdminPage";
import HubPage from "./pages/HubPage";
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
import BookingConfirmation from "./pages/BookingConfirmation";
import BookingConfirmed from "./pages/BookingConfirmed";
import MembershipPage from "./pages/MembershipPage";
import MembershipConfirmed from "./pages/MembershipConfirmed";
import WellnessCertificatePage from "./pages/WellnessCertificatePage";
import ClaimPassPage from "./pages/ClaimPassPage";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/reset" element={<AuthReset />} />
            <Route path="/" element={<TodayPage />} />
            <Route path="/desk" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/hub" element={<HubPage />} />
            <Route path="/hub/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
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
            <Route path="/membership" element={<MembershipPage />} />
            <Route path="/membership/confirmed" element={<MembershipConfirmed />} />
            <Route path="/wellness" element={<WellnessCertificatePage />} />
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

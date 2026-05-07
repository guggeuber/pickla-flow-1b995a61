import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import LinkHub from "./pages/LinkHub";
import EventOps from "./pages/EventOps";
import AdminPage from "./pages/AdminPage";
import HubPage from "./pages/HubPage";
import Auth from "./pages/Auth";
import MyPage from "./pages/MyPage";
import CommunityPage from "./pages/CommunityPage";
import PlayPage from "./pages/PlayPage";
import EventsListPage from "./pages/EventsListPage";
import OpenPlayPage from "./pages/OpenPlayPage";
import EventPage from "./pages/EventPage";
import BookingPage from "./pages/BookingPage";
import BookingConfirmation from "./pages/BookingConfirmation";
import BookingConfirmed from "./pages/BookingConfirmed";
import MembershipPage from "./pages/MembershipPage";
import MembershipConfirmed from "./pages/MembershipConfirmed";
import ClaimPassPage from "./pages/ClaimPassPage";
import CorporateJoinPage from "./pages/CorporateJoinPage";
import CorporateDashboard from "./pages/CorporateDashboard";
import CorporateRegisterPage from "./pages/CorporateRegisterPage";
import VenueDisplay from "./pages/VenueDisplay";
import OpenPlayDisplay from "./pages/OpenPlayDisplay";
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
            <Route path="/" element={<LinkHub />} />
            <Route path="/desk" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/hub" element={<HubPage />} />
            <Route path="/hub/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            <Route path="/activity" element={<MyPage />} />
            <Route path="/my" element={<MyPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/events" element={<EventsListPage />} />
            <Route path="/openplay" element={<OpenPlayPage />} />
            <Route path="/event-ops" element={<ProtectedRoute><EventOps /></ProtectedRoute>} />
            <Route path="/event/:id" element={<EventPage />} />
            <Route path="/e/:slug" element={<EventPage />} />
            <Route path="/book" element={<BookingPage />} />
            <Route path="/membership" element={<MembershipPage />} />
            <Route path="/membership/confirmed" element={<MembershipConfirmed />} />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

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
import Auth from "./pages/Auth";
import MyPage from "./pages/MyPage";
import CommunityPage from "./pages/CommunityPage";
import PlayPage from "./pages/PlayPage";
import EventPage from "./pages/EventPage";
import BookingPage from "./pages/BookingPage";
import BookingConfirmation from "./pages/BookingConfirmation";
import MembershipPage from "./pages/MembershipPage";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
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
            <Route path="/" element={<LinkHub />} />
            <Route path="/desk" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/hub" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            <Route path="/my" element={<MyPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/event-ops" element={<ProtectedRoute><EventOps /></ProtectedRoute>} />
            <Route path="/event/:id" element={<EventPage />} />
            <Route path="/e/:slug" element={<EventPage />} />
            <Route path="/book" element={<BookingPage />} />
            <Route path="/membership" element={<MembershipPage />} />
            <Route path="/b/:ref" element={<BookingConfirmation />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

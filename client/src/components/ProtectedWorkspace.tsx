import { useAuth } from "@/_core/hooks/useAuth";
import LoginScreen from "@/components/LoginScreen";
import Home from "@/pages/Home";
import { Loader2 } from "lucide-react";

export default function ProtectedWorkspace() {
  const { loading, isAuthenticated } = useAuth();
  if (loading) return <main className="min-h-screen grid place-items-center bg-[#121322] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  if (!isAuthenticated) return <LoginScreen />;
  return <Home />;
}

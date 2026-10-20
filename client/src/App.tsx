import { UndoBridge } from "@/components/UndoPanel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ProtectedWorkspace from "./components/ProtectedWorkspace";
import { ThemeProvider } from "./contexts/ThemeContext";

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark" switchable><TooltipProvider><Toaster richColors theme="dark" position="top-right"/><UndoBridge /><Switch><Route path="/" component={ProtectedWorkspace}/><Route path="/app/:rest*" component={ProtectedWorkspace}/><Route path="/404" component={NotFound}/><Route component={NotFound}/></Switch></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

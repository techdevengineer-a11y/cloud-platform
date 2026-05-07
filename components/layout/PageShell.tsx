import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-[#f4f7fb]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

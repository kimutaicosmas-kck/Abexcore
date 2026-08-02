import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { RealtimeSync } from './RealtimeSync';

const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_COLLAPSED = '4.5rem';

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const isMobileOverlay = mobileOpen && !sidebarCollapsed;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false);
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sidebarOffset = sidebarCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;

  const toggleSidebar = () => {
    if (window.innerWidth < 1024) {
      setMobileOpen((v) => !v);
      setSidebarCollapsed(false);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      <RealtimeSync />
      {isMobileOverlay && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-[#0a0b14]/60 backdrop-blur-md lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onToggle={toggleSidebar}
      />

      <TopNav
        onMenuClick={toggleSidebar}
        sidebarOffset={sidebarOffset}
        mobileOpen={mobileOpen}
      />

      <main
        className="pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] transition-all duration-300 min-w-0 overflow-x-hidden lg:ml-[var(--sidebar-w)]"
        style={{ '--sidebar-w': sidebarOffset } as React.CSSProperties}
      >
        <div className="px-4 py-4 sm:px-5 max-w-[1600px] mx-auto min-w-0 app-content">
          <div key={location.pathname} className="animate-fade-in min-w-0">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

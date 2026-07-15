import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';

const SIDEBAR_WIDTH = '15rem';
const SIDEBAR_COLLAPSED = '4rem';

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
    <div className="min-h-screen bg-slate-100/80">
      {isMobileOverlay && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
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
        className="pt-14 transition-all duration-300 min-h-screen lg:ml-[var(--sidebar-w)]"
        style={{ '--sidebar-w': sidebarOffset } as React.CSSProperties}
      >
        <div className="px-4 py-4 sm:px-5 max-w-[1600px] mx-auto">
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

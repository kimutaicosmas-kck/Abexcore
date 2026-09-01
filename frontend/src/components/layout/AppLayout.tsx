import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopNav } from './TopNav';
import { MobileBottomNav } from './MobileBottomNav';
import { RealtimeSync } from './RealtimeSync';
import { LoginWelcomeToast } from './LoginWelcomeToast';
import { TableScrollTouchFix } from './TableScrollTouchFix';
import { useAuth } from '../../contexts/AuthContext';
import { applyCompanyBrandToDocument } from '../../utils/companyBrand';

const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_COLLAPSED = '4.5rem';

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { company } = useAuth();

  const isMobileOverlay = mobileOpen && !sidebarCollapsed;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    applyCompanyBrandToDocument(company);
  }, [company?.brandPrimary, company?.brandAccent, company?.brandMode, company?.id, company?.slug]);

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
    <div className="mobile-app-shell min-h-dvh">
      <RealtimeSync />
      <TableScrollTouchFix />
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
      <LoginWelcomeToast />

      <main
        className="pt-[calc(3.5rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pt-14 lg:pb-[max(1rem,env(safe-area-inset-bottom))] transition-all duration-300 min-w-0 lg:ml-[var(--sidebar-w)]"
        style={{ '--sidebar-w': sidebarOffset } as React.CSSProperties}
      >
        <div className="px-2.5 py-2.5 sm:px-5 sm:py-4 max-w-[1600px] mx-auto min-w-0 app-content">
          <div key={location.pathname} className="animate-fade-in min-w-0">
            <Outlet />
          </div>
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}

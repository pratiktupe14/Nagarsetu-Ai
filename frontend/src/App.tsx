import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { NotificationProvider } from './context/NotificationContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardLayout } from './components/DashboardLayout';

// Public Landing Page (Eagerly loaded for instant First Contentful Paint)
import { LandingPage } from './pages/LandingPage';

// Lazy-loaded Public Pages
const LoginPage = React.lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = React.lazy(() => import('./pages/RegisterPage').then(m => ({ default: m.RegisterPage })));

// Lazy-loaded Citizen Pages
const CitizenPortal = React.lazy(() => import('./pages/citizen/CitizenPortal').then(m => ({ default: m.CitizenPortal })));
const MyComplaintsPage = React.lazy(() => import('./pages/citizen/MyComplaintsPage').then(m => ({ default: m.MyComplaintsPage })));
const NearbyIssuesPage = React.lazy(() => import('./pages/citizen/NearbyIssuesPage').then(m => ({ default: m.NearbyIssuesPage })));
const ReportIssuePage = React.lazy(() => import('./pages/citizen/ReportIssuePage').then(m => ({ default: m.ReportIssuePage })));
const SubmissionSuccessPage = React.lazy(() => import('./pages/citizen/SubmissionSuccessPage').then(m => ({ default: m.SubmissionSuccessPage })));
const ComplaintDetailPage = React.lazy(() => import('./pages/citizen/ComplaintDetailPage').then(m => ({ default: m.ComplaintDetailPage })));
const CitizenProfilePage = React.lazy(() => import('./pages/citizen/CitizenProfilePage').then(m => ({ default: m.CitizenProfilePage })));
const CitizenSettingsPage = React.lazy(() => import('./pages/citizen/CitizenSettingsPage').then(m => ({ default: m.CitizenSettingsPage })));
const CitizenNotificationsPage = React.lazy(() => import('./pages/citizen/CitizenNotificationsPage').then(m => ({ default: m.CitizenNotificationsPage })));
const AnnouncementDetailPage = React.lazy(() => import('./pages/citizen/AnnouncementDetailPage').then(m => ({ default: m.AnnouncementDetailPage })));
const CitizenWorkPage = React.lazy(() => import('./pages/citizen/CitizenWorkPage').then(m => ({ default: m.CitizenWorkPage })));
const MaintenanceDetailPage = React.lazy(() => import('./pages/citizen/MaintenanceDetailPage').then(m => ({ default: m.MaintenanceDetailPage })));
const TrackComplaintPage = React.lazy(() => import('./pages/citizen/TrackComplaintPage').then(m => ({ default: m.TrackComplaintPage })));

// Lazy-loaded Admin Pages
const AdminPortal = React.lazy(() => import('./pages/admin/AdminPortal').then(m => ({ default: m.AdminPortal })));
const AdminComplaintsPage = React.lazy(() => import('./pages/admin/AdminComplaintsPage').then(m => ({ default: m.AdminComplaintsPage })));
const AdminNewComplaintsPage = React.lazy(() => import('./pages/admin/AdminNewComplaintsPage').then(m => ({ default: m.AdminNewComplaintsPage })));
const AdminPendingComplaintsPage = React.lazy(() => import('./pages/admin/AdminPendingComplaintsPage').then(m => ({ default: m.AdminPendingComplaintsPage })));
const AdminInProgressComplaintsPage = React.lazy(() => import('./pages/admin/AdminInProgressComplaintsPage').then(m => ({ default: m.AdminInProgressComplaintsPage })));
const AdminResolvedComplaintsPage = React.lazy(() => import('./pages/admin/AdminResolvedComplaintsPage').then(m => ({ default: m.AdminResolvedComplaintsPage })));
const AdminOverdueComplaintsPage = React.lazy(() => import('./pages/admin/AdminOverdueComplaintsPage').then(m => ({ default: m.AdminOverdueComplaintsPage })));
const AdminDepartmentsPage = React.lazy(() => import('./pages/admin/AdminDepartmentsPage').then(m => ({ default: m.AdminDepartmentsPage })));
const AdminDepartmentHeadsPage = React.lazy(() => import('./pages/admin/AdminDepartmentHeadsPage').then(m => ({ default: m.AdminDepartmentHeadsPage })));
const AdminDepartmentDashboardPage = React.lazy(() => import('./pages/admin/AdminDepartmentDashboardPage').then(m => ({ default: m.AdminDepartmentDashboardPage })));
const AdminCityMapPage = React.lazy(() => import('./pages/admin/AdminCityMapPage').then(m => ({ default: m.AdminCityMapPage })));
const AdminAnalyticsPage = React.lazy(() => import('./pages/admin/AdminAnalyticsPage').then(m => ({ default: m.AdminAnalyticsPage })));
const AdminReportsPage = React.lazy(() => import('./pages/admin/AdminReportsPage').then(m => ({ default: m.AdminReportsPage })));
const AdminNotificationsPage = React.lazy(() => import('./pages/admin/AdminNotificationsPage').then(m => ({ default: m.AdminNotificationsPage })));
const AdminSettingsPage = React.lazy(() => import('./pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));

// Lazy-loaded Staff Pages
const StaffPortal = React.lazy(() => import('./pages/staff/StaffPortal').then(m => ({ default: m.StaffPortal })));
const StaffNewTasksPage = React.lazy(() => import('./pages/staff/StaffNewTasksPage').then(m => ({ default: m.StaffNewTasksPage })));
const StaffInProgressTasksPage = React.lazy(() => import('./pages/staff/StaffInProgressTasksPage').then(m => ({ default: m.StaffInProgressTasksPage })));
const StaffOverdueTasksPage = React.lazy(() => import('./pages/staff/StaffOverdueTasksPage').then(m => ({ default: m.StaffOverdueTasksPage })));
const StaffCompletedTasksPage = React.lazy(() => import('./pages/staff/StaffCompletedTasksPage').then(m => ({ default: m.StaffCompletedTasksPage })));
const StaffTaskMapPage = React.lazy(() => import('./pages/staff/StaffTaskMapPage').then(m => ({ default: m.StaffTaskMapPage })));
const StaffNotificationsPage = React.lazy(() => import('./pages/staff/StaffNotificationsPage').then(m => ({ default: m.StaffNotificationsPage })));
const StaffSettingsPage = React.lazy(() => import('./pages/staff/StaffSettingsPage').then(m => ({ default: m.StaffSettingsPage })));

// Lazy-loaded Department Head & Announcements Pages
const DepartmentHeadPortal = React.lazy(() => import('./pages/departmentHead/DepartmentHeadPortal').then(m => ({ default: m.DepartmentHeadPortal })));
const AnnouncementsWorkspacePage = React.lazy(() => import('./pages/announcements/AnnouncementsWorkspacePage').then(m => ({ default: m.AnnouncementsWorkspacePage })));
const StaffManagementWorkspacePage = React.lazy(() => import('./pages/departmentHead/StaffManagementWorkspacePage').then(m => ({ default: m.StaffManagementWorkspacePage })));

// Lazy-loaded Developer Super Admin Control Center
const SuperAdminConsolePage = React.lazy(() => import('./pages/developer/SuperAdminConsolePage').then(m => ({ default: m.SuperAdminConsolePage })));

// Lightweight Route Suspense Fallback (Eliminates dark viewport flash)
const PageFallback: React.FC = () => (
  <div className="min-h-screen bg-white text-gray-900 flex flex-col items-center justify-center p-6 font-sans">
    <div className="flex flex-col items-center space-y-4 max-w-sm w-full text-center">
      <div className="w-8 h-8 border-2 border-emerald-600/20 border-t-emerald-600 rounded-full animate-spin" />
      <div className="space-y-1">
        <h3 className="text-base font-extrabold font-outfit text-gray-900 tracking-wider">NAGARSETU</h3>
        <p className="text-xs text-gray-500 font-medium">Loading workspace...</p>
      </div>
    </div>
  </div>
);

// Lightweight Content Area Fallback (Preserves header and sidebar during section navigation)
const PortalContentFallback: React.FC = () => (
  <div className="flex-1 w-full p-8 flex items-center justify-center min-h-[350px]">
    <div className="w-8 h-8 border-2 border-emerald-600/20 border-t-emerald-600 rounded-full animate-spin" />
  </div>
);

// Shared Persistent Portal Layout with Content-Scoped Suspense Boundary
const PortalLayout: React.FC = () => (
  <DashboardLayout>
    <Suspense fallback={<PortalContentFallback />}>
      <Outlet />
    </Suspense>
  </DashboardLayout>
);

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <LanguageProvider>
          <NotificationProvider>
            <BrowserRouter>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  {/* Public Landing & Auth Routes */}
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />

                  {/* General Shared Announcements Route */}
                  <Route
                    path="/announcements"
                    element={
                      <ProtectedRoute allowedRoles={['citizen', 'city_admin', 'department_head', 'service_staff']}>
                        <AnnouncementsWorkspacePage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Citizen Protected Portal Layout & Routes */}
                  <Route
                    element={
                      <ProtectedRoute allowedRoles={['citizen']}>
                        <PortalLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/citizen/portal" element={<CitizenPortal />} />
                    <Route path="/citizen/dashboard" element={<CitizenPortal />} />
                    <Route path="/citizen/complaints" element={<MyComplaintsPage />} />
                    <Route path="/citizen/nearby" element={<NearbyIssuesPage />} />
                    <Route path="/citizen/announcements" element={<AnnouncementsWorkspacePage />} />
                    <Route path="/citizen/announcements/:id" element={<AnnouncementDetailPage />} />
                    <Route path="/citizen/work" element={<CitizenWorkPage />} />
                    <Route path="/citizen/work/:id" element={<MaintenanceDetailPage />} />
                    <Route path="/citizen/notifications" element={<CitizenNotificationsPage />} />
                    <Route path="/citizen/report" element={<ReportIssuePage />} />
                    <Route path="/citizen/success" element={<SubmissionSuccessPage />} />
                    <Route path="/citizen/complaint/:id" element={<ComplaintDetailPage />} />
                    <Route path="/citizen/track" element={<TrackComplaintPage />} />
                    <Route path="/citizen/track/:id" element={<TrackComplaintPage />} />
                    <Route path="/citizen/profile" element={<CitizenProfilePage />} />
                    <Route path="/citizen/settings" element={<CitizenSettingsPage />} />
                  </Route>

                  {/* City Admin Protected Portal Layout & Routes */}
                  <Route
                    element={
                      <ProtectedRoute allowedRoles={['city_admin']}>
                        <PortalLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/admin/dashboard" element={<AdminPortal />} />
                    <Route path="/admin/portal" element={<AdminPortal />} />
                    <Route path="/admin/announcements" element={<AnnouncementsWorkspacePage />} />
                    <Route path="/admin/complaints" element={<AdminComplaintsPage />} />
                    <Route path="/admin/complaints/new" element={<AdminNewComplaintsPage />} />
                    <Route path="/admin/complaints/pending" element={<AdminPendingComplaintsPage />} />
                    <Route path="/admin/complaints/in-progress" element={<AdminInProgressComplaintsPage />} />
                    <Route path="/admin/complaints/resolved" element={<AdminResolvedComplaintsPage />} />
                    <Route path="/admin/complaints/overdue" element={<AdminOverdueComplaintsPage />} />
                    <Route path="/admin/departments" element={<AdminDepartmentsPage />} />
                    <Route path="/admin/department-heads" element={<AdminDepartmentHeadsPage />} />
                    <Route path="/admin/departments/dashboard" element={<AdminDepartmentDashboardPage />} />
                    <Route path="/admin/staff" element={<StaffManagementWorkspacePage />} />
                    <Route path="/admin/map" element={<AdminCityMapPage />} />
                    <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
                    <Route path="/admin/reports" element={<AdminReportsPage />} />
                    <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
                    <Route path="/admin/settings" element={<AdminSettingsPage />} />
                  </Route>

                  {/* Department Head Protected Portal Layout & Routes */}
                  <Route
                    element={
                      <ProtectedRoute allowedRoles={['department_head']}>
                        <PortalLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/department-head/announcements" element={<AnnouncementsWorkspacePage />} />
                    <Route path="/department-head/staff" element={<StaffManagementWorkspacePage />} />
                    {[
                      '/department/portal',
                      '/department-head/portal',
                      '/department/tasks',
                      '/department/tasks/in-progress',
                      '/department-head/complaints',
                      '/department-head/tasks/assign',
                      '/department-head/tasks/in-progress',
                      '/department-head/tasks/completed',
                      '/department-head/tasks/overdue',
                      '/department/tasks/overdue',
                      '/department-head/staff/:staffId',
                      '/department-head/map',
                      '/department/map',
                      '/department-head/notifications',
                      '/department-head/profile',
                      '/department-head/settings'
                    ].map((path) => (
                      <Route key={path} path={path} element={<DepartmentHeadPortal />} />
                    ))}
                  </Route>

                  {/* Service Staff Protected Portal Layout & Routes */}
                  <Route
                    element={
                      <ProtectedRoute allowedRoles={['service_staff']}>
                        <PortalLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/staff/announcements" element={<AnnouncementsWorkspacePage />} />
                    <Route path="/staff/portal" element={<StaffPortal />} />
                    <Route path="/staff/dashboard" element={<StaffPortal />} />
                    <Route path="/staff/tasks" element={<StaffPortal />} />
                    <Route path="/staff/tasks/new" element={<StaffNewTasksPage />} />
                    <Route path="/staff/tasks/in-progress" element={<StaffInProgressTasksPage />} />
                    <Route path="/staff/tasks/overdue" element={<StaffOverdueTasksPage />} />
                    <Route path="/staff/tasks/completed" element={<StaffCompletedTasksPage />} />
                    <Route path="/staff/map" element={<StaffTaskMapPage />} />
                    <Route path="/staff/tasks/map" element={<StaffTaskMapPage />} />
                    <Route path="/staff/notifications" element={<StaffNotificationsPage />} />
                    <Route path="/staff/settings" element={<StaffSettingsPage />} />
                    <Route path="/staff/profile" element={<StaffSettingsPage />} />
                  </Route>

                  {/* Isolated Developer Super Admin Control Center */}
                  <Route path="/developer/secure-console" element={<SuperAdminConsolePage />} />

                  {/* Catch-all redirect to Landing */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
      </NotificationProvider>
    </LanguageProvider>
  </AuthProvider>
</ErrorBoundary>
  );
}

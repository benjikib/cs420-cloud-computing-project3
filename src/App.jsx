import './App.css'
import HomePage from './components/HomePage.jsx'
import LoginPage from './components/LoginPage.jsx'
import MotionDetails from './components/MotionDetailsPage.jsx'
import Settings from './components/SettingsPage.jsx'
import Profile from './components/ProfilePage.jsx'
import ChairControlPage from './components/ChairControlPage.jsx'
import CommitteesPage from './components/CommitteesPage.jsx'
import CommitteeMotionsPage from './components/CommitteeMotionsPage.jsx'
import CommitteeSettingsPage from './components/CommitteeSettingsPage.jsx'
import CreateMotionPage from './components/CreateMotionPage.jsx'
import EditMotionPage from './components/EditMotionPage.jsx'
import CreateCommitteePage from './components/CreateCommitteePage.jsx'
import UserControlPage from './components/UserControlPage.jsx'
import NotFoundPage from './components/NotFoundPage.jsx'
import AdminPanel from './components/AdminPanel.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

export default function App() {
  const location = useLocation();
  const background = location.state?.background;

  // Check if we're on a motion details route without background state (direct navigation)
  const isMotionDetailsRoute = location.pathname.match(/\/committee\/[^\/]+\/motion\/[^\/]+/);
  const shouldShowModal = background || isMotionDetailsRoute;

  return (
    <>
      <ScrollToTop />
      <Routes location={background || location}>
        <Route path="/" element={<LoginPage />}></Route>
        <Route path="/login" element={<LoginPage />}></Route>
        <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>}></Route>
        <Route path="/committees" element={<ProtectedRoute><CommitteesPage /></ProtectedRoute>}></Route>
        <Route path="/create-committee" element={<ProtectedRoute><CreateCommitteePage /></ProtectedRoute>}></Route>
        <Route path="/committee/:id" element={<ProtectedRoute><CommitteeMotionsPage /></ProtectedRoute>}></Route>
        <Route path="/committee/:id/settings" element={<ProtectedRoute><CommitteeSettingsPage /></ProtectedRoute>}></Route>
        <Route path="/committee/:id/create-motion" element={<ProtectedRoute><CreateMotionPage /></ProtectedRoute>}></Route>
        <Route path="/committee/:id/motion/:motionId/edit" element={<ProtectedRoute><EditMotionPage /></ProtectedRoute>}></Route>
        <Route path="/committee/:committeeId/motion/:motionId" element={<ProtectedRoute><CommitteeMotionsPage /></ProtectedRoute>}></Route>
        <Route path="/user-control" element={<ProtectedRoute><UserControlPage /></ProtectedRoute>}></Route>
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>}></Route>
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>}></Route>
        <Route path="/chair-control" element={<ProtectedRoute><ChairControlPage /></ProtectedRoute>}></Route>
        <Route path="/chair-control/:committeeId" element={<ProtectedRoute><ChairControlPage /></ProtectedRoute>}></Route>
        <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>}></Route>
        <Route path="*" element={<NotFoundPage />}></Route>
      </Routes>

      {shouldShowModal && (
        <Routes>
          <Route path="/committee/:committeeId/motion/:motionId" element={<ProtectedRoute><MotionDetails /></ProtectedRoute>}></Route>
        </Routes>
      )}
    </>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import HeaderNav from './reusable/HeaderNav';
import SideBar from './reusable/SideBar';
import { getCommitteeById } from '../services/committeeApi';
import { getMotionById, updateMotion } from '../services/motionApi';
import { getCurrentUser, isAdmin } from '../services/userApi';
import NoAccessPage from './NoAccessPage';

function EditMotionPage() {
    const { committeeId, motionId } = useParams();
    const navigate = useNavigate();
    const [committee, setCommittee] = useState(null);
    const [motion, setMotion] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [hasAccess, setHasAccess] = useState(null);
    const [formData, setFormData] = useState({ title: '', description: '', fullDescription: '' });

    useEffect(() => {
        async function load() {
            try {
                setLoading(true);
                const c = await getCommitteeById(committeeId);
                setCommittee(c.committee || c);
                const m = await getMotionById(committeeId, motionId);
                const motionData = m.motion || m;
                setMotion(motionData);
                setFormData({ title: motionData.title || '', description: motionData.description || '', fullDescription: motionData.fullDescription || '' });
                const userRes = await getCurrentUser();
                const user = userRes && (userRes.user || userRes.data) || userRes || null;
                if (!user) {
                    navigate('/login');
                    return;
                }
                setCurrentUser(user);
                // Author can edit
                const isAuthor = motionData.author && (String(motionData.author) === String(user?.id || user?.userId));
                const isAdminUser = user && isAdmin(user);
                setHasAccess(isAuthor || isAdminUser);
            } catch (err) {
                console.error('Failed to load motion/committee', err);
            } finally {
                setLoading(false);
            }
        }
        if (committeeId && motionId) load();
    }, [committeeId, motionId]);

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const updates = {};
            if (formData.title) updates.title = formData.title;
            if (formData.description) updates.description = formData.description;
            if (formData.fullDescription) updates.fullDescription = formData.fullDescription;
            await updateMotion(committeeId, motionId, updates);
            navigate(`/committee/${committeeId}`);
        } catch (err) {
            console.error('Failed to update motion', err);
            alert('Failed to update motion');
        }
    }

    if (loading) return (
        <>
            <HeaderNav />
            <SideBar />
            <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">Loading...</div>
        </>
    );

    if (!hasAccess) {
        return (
            <>
                <HeaderNav />
                <SideBar />
                <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">
                    <NoAccessPage committeeId={committeeId} committeeTitle={committee?.title} />
                </div>
            </>
        );
    }

    return (
        <>
            <HeaderNav />
            <SideBar />
            <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">
                <div className="max-w-4xl">
                    <h2 className="section-title">Edit Motion</h2>
                    <form onSubmit={handleSubmit} className="space-y-6 mt-6">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg">
                            <label className="block text-sm font-semibold mb-2">Title</label>
                            <input name="title" value={formData.title} onChange={handleChange} className="w-full px-4 py-2 border rounded" />
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg">
                            <label className="block text-sm font-semibold mb-2">Description</label>
                            <textarea name="description" value={formData.description} onChange={handleChange} className="w-full px-4 py-2 border rounded" rows={4} />
                        </div>
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg">
                            <label className="block text-sm font-semibold mb-2">Full Description</label>
                            <textarea name="fullDescription" value={formData.fullDescription} onChange={handleChange} className="w-full px-4 py-2 border rounded" rows={6} />
                        </div>
                        <div className="flex gap-4 justify-end">
                            <button type="button" className="px-6 py-2 border rounded" onClick={() => navigate(`/committee/${committeeId}/motion/${motionId}`)}>Cancel</button>
                            <button type="submit" className="px-6 py-2 bg-lighter-green text-white rounded">Update Motion</button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}

export default EditMotionPage;

import { useState, useEffect, useRef } from "react";
import { getCommentsByMotion, createComment } from '../services/commentApi';
import { getCurrentUser } from '../services/userApi';

export default function MotionDetailsComments({ committeeId, motionId, isDebatable = true, isGuest = false, onCommentsLoad }) {
        const [comments, setComments] = useState([]);
        const [newComment, setNewComment] = useState("");
        const [stance, setStance] = useState("neutral");
        const [currentUser, setCurrentUser] = useState(null);
        const chatEndRef = useRef(null);

        // Load current user and existing messages for this motion
        useEffect(() => {
                let mounted = true;
                async function load() {
                        try {
                                const cur = await getCurrentUser().catch(() => null);
                                if (!mounted) return;
                                setCurrentUser(cur && cur.user ? cur.user : null);

                                if (!motionId) return;
                                const res = await getCommentsByMotion(committeeId, motionId, 1);
                                if (!mounted) return;
                                if (res && res.comments) {
                                        setComments(res.comments);
                                        // Notify parent about comment count
                                        if (onCommentsLoad) {
                                                onCommentsLoad(res.comments, false); // false = initial load
                                        }
                                }
                        } catch (e) {
                                console.error('Failed to load messages:', e);
                        }
                }
                load();
                return () => { mounted = false; };
        }, [motionId, committeeId, onCommentsLoad]);
        
        // Poll for new comments every 5 seconds
        useEffect(() => {
                if (!motionId || !committeeId) return;
                
                const pollComments = async () => {
                        try {
                                const res = await getCommentsByMotion(committeeId, motionId, 1);
                                if (res && res.comments) {
                                        setComments(res.comments);
                                        // Notify parent about comment count
                                        if (onCommentsLoad) {
                                                onCommentsLoad(res.comments, false);
                                        }
                                }
                        } catch (e) {
                                console.error('Failed to poll comments:', e);
                        }
                };
                
                const pollInterval = setInterval(pollComments, 5000);
                return () => clearInterval(pollInterval);
        }, [motionId, committeeId, onCommentsLoad]);

        // Automatically scroll to the latest message
        useEffect(() => {
                chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, [comments]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Prevent guests from creating comments
        if (isGuest) {
            setError('Guest users cannot post comments. Please contact an admin to change your role.');
            return;
        }

        if (!newComment.trim()) return;                try {
                        await createComment(committeeId, motionId, {
                                content: newComment,
                                stance: stance
                        });

                        // Reload comments
                        const res = await getCommentsByMotion(committeeId, motionId, 1);
                        if (res && res.comments) {
                                setComments(res.comments);
                                // Notify parent about updated comment count (mark as user-posted)
                                if (onCommentsLoad) {
                                        onCommentsLoad(res.comments, true); // true = user just posted
                                }
                        }
                        setNewComment("");
                        setStance("neutral"); // Reset stance to neutral
                } catch (err) {
                        console.error('Failed to send message:', err);
                        alert('Failed to send message');
                }
        };

        return (
                <div className="mx-auto bg-superlight-green shadow-md rounded-lg p-4 flex flex-col h-110">
                        <h2 className="text-lg font-semibold mb-3 text-gray-800">Chat</h2>

                        {/* Chat area */}
                        <div className="flex-grow overflow-y-auto bg-white border border-lighter-green/30 rounded-md p-3 space-y-3">
                                {comments.length === 0 ? (
                                        <p className="text-gray-600 text-sm text-center mt-10">No messages yet. Say hello!</p>
                                ) : (
                                        comments.map((comment) => {
                                                // System message rendering
                                                if (comment.isSystemMessage) {
                                                        const getSystemMessageStyle = (type) => {
                                                                switch (type) {
                                                                        case 'voting-eligible':
                                                                                return 'bg-green-50 border-green-200 text-green-800';
                                                                        case 'voting-opened':
                                                                                return 'bg-blue-50 border-blue-200 text-blue-800';
                                                                        case 'voting-closed':
                                                                                return 'bg-gray-50 border-gray-200 text-gray-800';
                                                                        case 'roll-call-vote':
                                                                                return 'bg-purple-50 border-purple-200 text-purple-800';
                                                                        default:
                                                                                return 'bg-yellow-50 border-yellow-200 text-yellow-800';
                                                                }
                                                        };

                                                        const getSystemIcon = (type) => {
                                                                switch (type) {
                                                                        case 'voting-eligible':
                                                                                return '✓';
                                                                        case 'voting-opened':
                                                                        case 'voting-closed':
                                                                                return '🗳️';
                                                                        case 'roll-call-vote':
                                                                                return '📢';
                                                                        default:
                                                                                return 'ℹ️';
                                                                }
                                                        };

                                                        return (
                                                                <div key={comment.commentId || comment.id} className="flex justify-center my-2">
                                                                        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${getSystemMessageStyle(comment.messageType)} max-w-[80%]`}>
                                                                                <span className="text-base">{getSystemIcon(comment.messageType)}</span>
                                                                                <p className="text-sm font-medium">{comment.content}</p>
                                                                                <span className="text-xs opacity-70 ml-2">
                                                                                        {new Date(comment.createdAt).toLocaleTimeString()}
                                                                                </span>
                                                                        </div>
                                                                </div>
                                                        );
                                                }

                                                // Regular user comment rendering
                                                const senderName = comment.authorName || comment.authorInfo?.name || 'Unknown User';
                                                const isMine = currentUser && String(currentUser.id || currentUser.userId) === String(comment.author);
                                                
                                                return (
                                                        <div key={comment.commentId || comment.id} className={`flex items-center gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
                                                                {!isMine && (
                                                                        <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0 overflow-hidden self-start mt-6">
                                                                                <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                                                        {senderName.charAt(0).toUpperCase()}
                                                                                </div>
                                                                        </div>
                                                                )}
                                                                <div className="flex flex-col max-w-[85%]">
                                                                        <span className={`text-xs text-gray-500 mb-1 px-1 ${isMine ? 'text-end' : 'text-start'}`}>
                                                                                {isMine ? (currentUser && (currentUser.name || 'You')) : senderName}
                                                                        </span>
                                                                        <div className={`px-3 py-2 rounded-xl w-full whitespace-pre-wrap break-words ${isMine ? 'bg-lighter-green text-white rounded-br-none' : 'bg-gray-200 text-gray-800 rounded-bl-none'}`}>
                                                                                {comment.stance && comment.stance !== 'neutral' && (
                                                                                        <span className={`text-xs font-semibold uppercase block mb-1 ${
                                                                                                comment.stance === 'pro' ? 'text-green-700' : 'text-red-700'
                                                                                        }`}>
                                                                                                {comment.stance === 'pro' ? '✓ Pro' : '✗ Con'}
                                                                                        </span>
                                                                                )}
                                                                                {comment.content}
                                                                        </div>
                                                                </div>
                                                                {isMine && (
                                                                        <div className="w-8 h-8 rounded-full bg-lighter-green flex-shrink-0 overflow-hidden self-start mt-6">
                                                                                <div className="w-full h-full flex items-center justify-center text-white text-xs">You</div>
                                                                        </div>
                                                                )}
                                                        </div>
                                                );
                                        })
                                )}

                                <div ref={chatEndRef} />
                        </div>

                        {/* Input area - only show if debatable */}
                        {isDebatable ? (
                        <form onSubmit={handleSubmit} className="mt-3">
                                <div className="flex gap-1.5 mb-2">
                                        <button
                                                type="button"
                                                onClick={() => setStance("pro")}
                                                className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
                                                        stance === "pro" 
                                                                ? "bg-green-700 text-white" 
                                                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                                }`}
                                        >
                                                ✓ Pro
                                        </button>
                                        <button
                                                type="button"
                                                onClick={() => setStance("neutral")}
                                                className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
                                                        stance === "neutral" 
                                                                ? "bg-blue-500 text-white" 
                                                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                                }`}
                                        >
                                                Neutral
                                        </button>
                                        <button
                                                type="button"
                                                onClick={() => setStance("con")}
                                                className={`flex-1 px-2 py-1 rounded text-xs font-medium ${
                                                        stance === "con" 
                                                                ? "bg-red-700 text-white" 
                                                                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                                }`}
                                        >
                                                ✗ Con
                                        </button>
                                </div>
                                <div className="flex gap-2">
                                        <input 
                                                type="text" 
                                                placeholder={isGuest ? "Guests cannot post comments" : "Type a message..."} 
                                                value={newComment} 
                                                onChange={(e) => setNewComment(e.target.value)} 
                                                className="flex-grow border border-lighter-green rounded-md p-2 text-sm focus:outline-none bg-white text-gray-800" 
                                                autoComplete="off"
                                                disabled={isGuest}
                                        />
                                        <button 
                                                type="submit" 
                                                className="px-4 py-2 bg-darker-green text-white rounded-md hover:bg-opacity-90 font-medium text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed" 
                                                disabled={isGuest}
                                        >
                                                Send
                                        </button>
                                </div>
                                {isGuest && (
                                        <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md">
                                                <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                                                        <span className="material-symbols-outlined text-lg">info</span>
                                                        Guest users cannot post comments. Please contact an admin to change your role.
                                                </p>
                                        </div>
                                )}
                        </form>
                        ) : (
                                <div className="mt-3 p-3 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md">
                                        <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                                                <span className="material-symbols-outlined text-lg">info</span>
                                                This motion is not debatable. Comments are disabled.
                                        </p>
                                </div>
                        )}
                </div>
        );
}

// import { useState, useRef, useEffect } from "react";

// export default function MotionDetailsComments() {
//   const [comments, setComments] = useState([]);
//   const [newComment, setNewComment] = useState("");

//   const handleSubmit = (e) => {
//     e.preventDefault();
//     if (!newComment.trim()) return;

//     setComments((prev) => [
//       ...prev,
//       {
//         id: Date.now(),
//         text: newComment,
//       },
//     ]);

//     setNewComment("");
//   };

//   const handleDelete = (id) => {
//     setComments((prev) => prev.filter((comment) => comment.id !== id));
//   };

//   const chatRef = useRef(null);

//   // auto-scroll to bottom when comments change
//   useEffect(() => {
//     if (chatRef.current) {
//       chatRef.current.scrollTop = chatRef.current.scrollHeight;
//     }
//   }, [comments]);

//   return (
//     <div className="w-full mx-auto bg-superlight-green shadow-md rounded-lg p-4">
//       <h2 className="text-lg font-semibold mb-3 text-gray-800">Comments</h2>

//       {/* Chat area */}
//       <div
//         ref={chatRef}
//         className="chat-box mb-3 p-2 space-y-2 overflow-y-auto"
//         style={{ maxHeight: 320 }}
//       >
//         {comments.length === 0 ? (
//           <div className="text-gray-600 text-sm">No comments yet. Be the first to comment!</div>
//         ) : (
//           comments.map((comment) => (
//             <div key={comment.id} className="flex items-start gap-3">
//               <div className="w-8 h-8 rounded-full bg-lighter-green flex items-center justify-center text-white font-bold text-sm">
//                 U
//               </div>
//               <div className="flex-1">
//                 <div className="bg-white p-3 rounded-md text-gray-800 border border-lighter-green/20">
//                   {comment.text}
//                 </div>
//                 <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
//                   <span>{new Date(comment.id).toLocaleString()}</span>
//                   <button
//                     onClick={() => handleDelete(comment.id)}
//                     className="text-lighter-green text-xs hover:text-darker-green"
//                     aria-label="Delete comment"
//                   >
//                     Delete
//                   </button>
//                 </div>
//               </div>
//             </div>
//           ))
//         )}
//       </div>

//       {/* Input area */}
//       <form onSubmit={handleSubmit} className="flex gap-2">
//         <input
//           type="text"
//           placeholder="Write a comment..."
//           value={newComment}
//           onChange={(e) => setNewComment(e.target.value)}
//           className="flex-grow border rounded-md p-2 focus:outline-none bg-white text-gray-800 border-lighter-green"
//         />
//         <button
//           type="submit"
//           className="bg-lighter-green text-white px-4 py-2 rounded-md hover:bg-darker-green"
//         >
//           Send
//         </button>
//       </form>
//     </div>
//   );
// }


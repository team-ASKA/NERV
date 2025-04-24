import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, CheckCircle, AlertCircle, ArrowRight, Briefcase, Menu, User, Edit, LogOut, Linkedin, Globe, X, Upload, Clock, Calendar, BarChart, ChevronLeft, ChevronRight, ExternalLink, Trash2, History } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { collection, getDocs, query, where, setDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { extractTextFromPDF } from '../services/pdfService';

// Add proper type for user details
type UserDetails = {
  name: string;
  email: string;
  resumeURL: string | null;
  resumeName: string | null;
  linkedinURL: string | null;
  portfolioURL: string | null;
  expertise?: string[];
  skills?: string[];
  [key: string]: any; // Allow for additional properties
};

const Dashboard = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeLink, setResumeLink] = useState('');
  const [resumeLinkSuccess, setResumeLinkSuccess] = useState(false);
  const [resumeLinkError, setResumeLinkError] = useState('');
  const [updatingResumeLink, setUpdatingResumeLink] = useState(false);
  
  // Interview configuration options
  const [interviewDuration, setInterviewDuration] = useState<number>(15); // Default 15 minutes
  const [difficultyLevel, setDifficultyLevel] = useState<string>('medium');
  
  // Form state for profile editing
  const [editForm, setEditForm] = useState({
    displayName: '',
    location: '',
    experience: '',
    education: '',
    expectedSalary: '',
    linkedin: '',
    portfolio: '',
    skills: ''
  });
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  // Inside the Dashboard component, add these new state variables
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Add this new state for the alert
  const [showResumeAlert, setShowResumeAlert] = useState(false);

  // Add new state variables for interview history
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [interviewHistory, setInterviewHistory] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);

  // Add this new state for the improvement plan summary
  const [latestImprovementPlan, setLatestImprovementPlan] = useState<any>(null);

  // Fetch user details from Firestore
  useEffect(() => {
    const fetchUserDetails = async () => {
      if (!currentUser) return;
      
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          // Cast the Firestore data to our UserDetails type
          setUserDetails(userData as UserDetails);
          setResumeLink(userData.resumeURL || '');
          
          // Initialize edit form with current values
          setEditForm({
            displayName: userData.displayName || '',
            location: userData.location || '',
            experience: userData.experience || '',
            education: userData.education || '',
            expectedSalary: userData.expectedSalary || '',
            linkedin: userData.linkedin || '',
            portfolio: userData.portfolio || '',
            skills: userData.skills ? userData.skills.join(', ') : ''
          });
        } else {
          // Create a default user document
          const defaultUserData: UserDetails = {
            name: currentUser.displayName || '',
            email: currentUser.email || '',
            resumeURL: null,
            resumeName: null,
            linkedinURL: null,
            portfolioURL: null,
            displayName: currentUser.displayName || '',
            photoURL: currentUser.photoURL || '',
            createdAt: Timestamp.now(),
            skills: [],
            expertise: []
          };
          
          await setDoc(doc(db, 'users', currentUser.uid), defaultUserData);
          setUserDetails(defaultUserData);
        }
      } catch (error) {
        console.error('Error fetching user details:', error);
        setError('Failed to load user profile');
      } finally {
        setLoading(false);
      }
    };
    
    fetchUserDetails();
    
    // Load interview history from localStorage
    const storedHistory = localStorage.getItem('interviewHistory');
    if (storedHistory) {
      try {
        setInterviewHistory(JSON.parse(storedHistory));
      } catch (e) {
        console.error('Error parsing interview history:', e);
      }
    }
    
    // Load latest improvement plan from localStorage
    const storedPlan = localStorage.getItem('latestImprovementPlan');
    if (storedPlan) {
      try {
        setLatestImprovementPlan(JSON.parse(storedPlan));
      } catch (e) {
        console.error('Error parsing improvement plan:', e);
      }
    }
  }, [currentUser]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  };

  // Toggle menu
  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
    setIsEditingProfile(false);
  };
  
  // Toggle edit profile mode
  const toggleEditProfile = () => {
    setIsEditingProfile(!isEditingProfile);
  };

  // Handle resume link update
  const handleResumeUpdate = async () => {
    if (!currentUser || !resumeLink) return;

    setUpdatingResumeLink(true);
    setResumeLinkError('');

    try {
      // Validate URL format
      try {
        new URL(resumeLink);
      } catch (e) {
        throw new Error('Please enter a valid URL (include http:// or https://)');
      }
      
      // Update user document with resume URL
      const userDocRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        resumeURL: resumeLink
      });
      
      // Update local state with proper typing
      setUserDetails((prev: any) => {
        if (!prev) return { resumeURL: resumeLink };
        return { ...prev, resumeURL: resumeLink };
      });
      
      setResumeLinkSuccess(true);
      
      // Reset success message after 3 seconds
      setTimeout(() => {
        setResumeLinkSuccess(false);
      }, 3000);
    } catch (err: any) {
      console.error('Resume link update error:', err);
      setResumeLinkError(err.message || 'Failed to update resume link. Please try again.');
    } finally {
      setUpdatingResumeLink(false);
    }
  };
  
  // Handle profile update
  const handleProfileUpdate = async () => {
    if (!currentUser) return;
    
    setUpdating(true);
    setError('');
    
    try {
      const skillsArray = editForm.skills
        ? editForm.skills.split(',').map(skill => skill.trim()).filter(skill => skill !== '')
        : [];
      
      const userDocRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        displayName: editForm.displayName,
        location: editForm.location,
        experience: editForm.experience,
        education: editForm.education,
        expectedSalary: editForm.expectedSalary,
        linkedin: editForm.linkedin,
        portfolio: editForm.portfolio,
        skills: skillsArray
      });
      
      // Update local state with proper typing
      setUserDetails((prev: UserDetails | null) => {
        if (!prev) return null;
        return { 
          ...prev, 
          displayName: editForm.displayName,
          location: editForm.location,
          experience: editForm.experience,
          education: editForm.education,
          expectedSalary: editForm.expectedSalary,
          linkedin: editForm.linkedin,
          portfolio: editForm.portfolio,
          skills: skillsArray
        };
      });
      
      setUpdateSuccess(true);
      
      // Reset success message after 3 seconds
      setTimeout(() => {
        setUpdateSuccess(false);
        setIsEditingProfile(false);
      }, 2000);
    } catch (err) {
      console.error('Profile update error:', err);
      setError('Failed to update profile. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  // Handle form input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Start interview with configuration options
  const startInterview = () => {
    // Store interview configuration in localStorage
    localStorage.setItem('interviewConfig', JSON.stringify({
      interviewDuration,
      difficultyLevel
    }));
    
    // During development, we'll allow starting interviews without a resume
    navigate('/interview');
    
    // The resume check code is commented out for development
    /*
    if (!userDetails?.resumeURL) {
      setShowResumeAlert(true);
      
      setTimeout(() => {
        setShowResumeAlert(false);
      }, 5000);
      return;
    }
    
    navigate('/interview');
    */
  };

  // Add this new function to handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    
    if (selectedFile) {
      // Check if file is a PDF
      if (selectedFile.type !== 'application/pdf') {
        setUploadError('Please upload a PDF file');
        setFile(null);
        return;
      }
      
      // Check file size (limit to 5MB)
      if (selectedFile.size > 5 * 1024 * 1024) {
        setUploadError('File size should be less than 5MB');
        setFile(null);
        return;
      }
      
      setFile(selectedFile);
      setUploadError('');
    }
  };

  // Add this function to handle resume upload
  const handleResumeFileUpload = async () => {
    if (!file) {
      setUploadError('Please select a file first');
      return;
    }
    
    setUploading(true);
    setUploadError('');
    
    try {
      console.log("Starting PDF processing of file:", file.name, file.size/1024, "KB");
      
      // Extract text from the PDF using our service
      const extractedText = await extractTextFromPDF(file);
      
      console.log("Successfully extracted text from PDF, length:", extractedText.length);
      
      // Verify the text content has reasonable length
      if (extractedText.length < 100) {
        setUploadError('The PDF text extraction resulted in very little content. Please try a different PDF.');
        setUploading(false);
        return;
      }
      
      // Store the extracted text in localStorage for use in the interview
      localStorage.setItem('resumeText', extractedText);
      console.log("Stored resume text in localStorage");
      
      // Update user metadata with file name (but not URL, since we're processing locally)
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
          resumeName: file.name,
          // We're not storing the resume in Firebase Storage anymore
          resumeURL: null
        });
        
        // Update local state
        setUserDetails(prev => ({
          ...prev!,
          resumeName: file.name,
          resumeURL: null
        }));
      }
      
      setFile(null);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
      
    } catch (error) {
      console.error('Error processing PDF:', error);
      setUploadError('Failed to process PDF. Please try again with a different file.');
    } finally {
      setUploading(false);
    }
  };

  // Add function to view interview results
  const viewInterviewResults = (interviewId: string) => {
    // Store the selected interview in localStorage
    const selectedInterview = interviewHistory.find(interview => interview.id === interviewId);
    if (selectedInterview) {
      localStorage.setItem('interviewResults', JSON.stringify(selectedInterview));
      navigate('/results');
    }
  };
  
  // Add function to delete interview from history
  const deleteInterview = (interviewId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the parent click
    
    const updatedHistory = interviewHistory.filter(interview => interview.id !== interviewId);
    setInterviewHistory(updatedHistory);
    localStorage.setItem('interviewHistory', JSON.stringify(updatedHistory));
  };
  
  // Calculate pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentInterviews = interviewHistory.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(interviewHistory.length / itemsPerPage);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Sticky Navbar */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-xl font-bold">NERV</h1>
          </div>
          
          <button
            onClick={toggleMenu}
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* User Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            {/* Backdrop with localized blur effect */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={toggleMenu}
            >
              {/* This creates a gradient that only blurs the right side of the screen */}
              <div className="h-full w-full bg-gradient-to-r from-black/30 to-black/70 backdrop-blur-[2px]">
                {/* Additional stronger blur for the area directly behind the menu */}
                <div className="absolute top-0 right-0 h-full w-[320px] bg-black/40 backdrop-blur-md" />
              </div>
            </motion.div>
            
            {/* Menu Panel */}
            <motion.div
              initial={{ opacity: 0, x: 300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 300 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-80 bg-black border-l border-white/10 z-50 overflow-y-auto"
            >
              <div className="p-6">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="text-xl font-bold">
                    {isEditingProfile ? 'Edit Profile' : 'Profile'}
                  </h2>
                  <button
                    onClick={toggleMenu}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Close menu"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full"></div>
                  </div>
                ) : (
                  <>
                    {isEditingProfile ? (
                      // Edit Profile Form
                      <div className="space-y-4">
                        {error && (
                          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm flex items-start">
                            <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
                            <span>{error}</span>
                          </div>
                        )}
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Full Name</label>
                          <input
                            type="text"
                            name="displayName"
                            value={editForm.displayName}
                            onChange={handleInputChange}
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Location</label>
                          <input
                            type="text"
                            name="location"
                            value={editForm.location}
                            onChange={handleInputChange}
                            placeholder="City, Country"
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Experience</label>
                          <input
                            type="text"
                            name="experience"
                            value={editForm.experience}
                            onChange={handleInputChange}
                            placeholder="e.g. 5 years"
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Education</label>
                          <input
                            type="text"
                            name="education"
                            value={editForm.education}
                            onChange={handleInputChange}
                            placeholder="Degree, Institution"
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Expected Salary</label>
                          <input
                            type="text"
                            name="expectedSalary"
                            value={editForm.expectedSalary}
                            onChange={handleInputChange}
                            placeholder="e.g. $80,000 - $100,000"
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">LinkedIn Profile</label>
                          <input
                            type="text"
                            name="linkedin"
                            value={editForm.linkedin}
                            onChange={handleInputChange}
                            placeholder="https://linkedin.com/in/username"
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Portfolio Website</label>
                          <input
                            type="text"
                            name="portfolio"
                            value={editForm.portfolio}
                            onChange={handleInputChange}
                            placeholder="https://yourportfolio.com"
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">Skills (comma separated)</label>
                          <textarea
                            name="skills"
                            value={editForm.skills}
                            onChange={handleInputChange}
                            placeholder="React, JavaScript, Node.js, etc."
                            className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors resize-none h-24"
                          />
                        </div>
                        
                        <div className="flex space-x-3 pt-2">
                          <button
                            type="button"
                            onClick={() => setIsEditingProfile(false)}
                            className="flex-1 py-2 border border-white/20 rounded-lg hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleProfileUpdate}
                            disabled={updating}
                            className="flex-1 py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {updating ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                        
                        {updateSuccess && (
                          <div className="flex items-center justify-center text-green-500 text-sm">
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Profile updated successfully
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* User profile header */}
                        <div className="flex items-center mb-6">
                          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-xl font-bold mr-4">
                            {userDetails?.displayName?.charAt(0) || currentUser?.email?.charAt(0) || 'U'}
                          </div>
                          <div>
                            <h3 className="font-medium text-lg">{userDetails?.displayName || 'User'}</h3>
                            <p className="text-gray-400 text-sm">{currentUser?.email}</p>
                          </div>
                        </div>

                        {/* User Details */}
                        <div className="bg-white/5 rounded-lg p-4 mb-4">
                          <h4 className="text-white text-sm font-medium mb-2">Account Details</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-gray-400 text-sm">Name</span>
                              <span className="text-white text-sm">
                                {userDetails?.displayName || 'Not set'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 text-sm">Location</span>
                              <span className="text-white text-sm">
                                {userDetails?.location || 'Not set'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 text-sm">Experience</span>
                              <span className="text-white text-sm">
                                {userDetails?.experience || 'Not set'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 text-sm">Education</span>
                              <span className="text-white text-sm">
                                {userDetails?.education || 'Not set'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 text-sm">Expected Salary</span>
                              <span className="text-white text-sm">
                                {userDetails?.expectedSalary || 'Not set'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 text-sm">Interviews Completed</span>
                              <span className="text-white text-sm">
                                {userDetails?.interviewsCompleted || '0'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Skills Section */}
                        <div className="bg-white/5 rounded-lg p-4 mb-4">
                          <h4 className="text-white text-sm font-medium mb-2">Skills & Expertise</h4>
                          <div className="mb-3">
                            <span className="text-gray-400 text-sm">Technical Expertise:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {userDetails?.expertise?.map((exp: string) => (
                                <span key={exp} className="text-xs bg-white/10 text-white px-2 py-1 rounded-full">
                                  {exp}
                                </span>
                              ))}
                              {(!userDetails?.expertise || userDetails.expertise.length === 0) && (
                                <span className="text-xs text-gray-400">No expertise added</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-400 text-sm">Skills:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {userDetails?.skills?.map((skill: string) => (
                                <span key={skill} className="text-xs bg-white/10 text-white px-2 py-1 rounded-full">
                                  {skill}
                                </span>
                              ))}
                              {(!userDetails?.skills || userDetails.skills.length === 0) && (
                                <span className="text-xs text-gray-400">No skills added</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Resume Card (Mobile view) */}
                        <div className="lg:hidden p-4 bg-white/5 rounded-lg mb-4">
                          <h3 className="text-lg font-semibold mb-2 flex items-center">
                            <FileText className="h-5 w-5 mr-2" />
                            Your Resume
                          </h3>
                          
                          {(userDetails?.resumeURL || localStorage.getItem('resumeText')) ? (
                            <div>
                              <p className="text-sm text-gray-400 mb-2">Your resume is ready for interviews</p>
                              {userDetails?.resumeURL ? (
                                <a 
                                  href={userDetails.resumeURL}
                                  target="_blank"
                                  rel="noopener noreferrer" 
                                  className="text-sm flex items-center text-blue-400 hover:text-blue-300"
                                >
                                  <FileText className="h-4 w-4 mr-2" />
                                  View Resume {userDetails.resumeName && `(${userDetails.resumeName})`}
                                </a>
                              ) : (
                                <div className="text-sm flex items-center text-green-400">
                                  <FileText className="h-4 w-4 mr-2" />
                                  Locally Processed Resume {userDetails?.resumeName && `(${userDetails.resumeName})`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center">
                              <AlertCircle className="h-4 w-4 mr-2 text-yellow-500" />
                              <p className="text-sm text-yellow-400">No resume added yet</p>
                            </div>
                          )}
                          
                          <button
                            onClick={() => document.getElementById('mobileResumeSection')?.scrollIntoView({ behavior: 'smooth' })}
                            className="mt-3 w-full py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
                          >
                            {userDetails?.resumeURL || localStorage.getItem('resumeText') ? 'Update Resume' : 'Add Resume'}
                          </button>
                        </div>

                        {/* Resume Upload Box */}
                        <div className="bg-black border border-white/10 rounded-xl p-6 shadow-lg hover:border-white/30 transition-all mb-6">
                          <h2 className="text-xl font-semibold mb-4 flex items-center">
                            <FileText className="h-5 w-5 mr-2" />
                            Your Resume
                          </h2>
                          
                          {(userDetails?.resumeURL || localStorage.getItem('resumeText')) ? (
                            <div className="mb-4">
                              <p className="text-gray-400 mb-2">Your resume is ready for interviews</p>
                              {userDetails?.resumeURL ? (
                                <a 
                                  href={userDetails.resumeURL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center text-blue-400 hover:text-blue-300"
                                >
                                  <FileText className="h-4 w-4 mr-2" />
                                  View Resume {userDetails.resumeName && `(${userDetails.resumeName})`}
                                </a>
                              ) : (
                                <div className="inline-flex items-center text-green-400">
                                  <FileText className="h-4 w-4 mr-2" />
                                  Locally Processed Resume {userDetails?.resumeName && `(${userDetails.resumeName})`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-gray-400 mb-4">Add your resume to enhance your interview experience</p>
                          )}
                          
                          <div className="space-y-4">
                            {/* File Upload Section */}
                            <div className="border border-dashed border-white/20 rounded-lg p-4 hover:border-white/40 transition-all">
                              <label htmlFor="resume-file-input" className="flex flex-col items-center justify-center cursor-pointer">
                                <Upload className="h-6 w-6 mb-2 text-gray-400" />
                                <span className="text-sm font-medium mb-1">Upload PDF Resume</span>
                                <span className="text-xs text-gray-500">Max 5MB</span>
                                <input 
                                  id="resume-file-input"
                                  type="file" 
                                  accept=".pdf" 
                                  onChange={handleFileChange}
                                  className="hidden" 
                                />
                              </label>
                              
                              {file && (
                                <div className="mt-3 flex items-center justify-between bg-white/5 p-2 rounded">
                                  <span className="text-sm truncate max-w-[200px]">{file.name}</span>
                                  <button 
                                    onClick={() => setFile(null)}
                                    className="text-gray-400 hover:text-white"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                              
                              {file && (
                                <button
                                  onClick={handleResumeFileUpload}
                                  disabled={uploading}
                                  className="w-full mt-3 py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                                >
                                  {uploading ? 'Uploading...' : 'Upload Resume'}
                                </button>
                              )}
                              
                              {uploadError && (
                                <div className="mt-2 flex items-center text-red-500 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                                  {uploadError}
                                </div>
                              )}
                              
                              {uploadSuccess && (
                                <div className="mt-2 flex items-center text-green-500 text-xs">
                                  <CheckCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                                  Resume uploaded successfully
                                </div>
                              )}
                            </div>
                            
                            {/* OR Divider */}
                            <div className="flex items-center">
                              <div className="flex-grow border-t border-white/10"></div>
                              <span className="mx-4 text-xs text-gray-500">OR</span>
                              <div className="flex-grow border-t border-white/10"></div>
                            </div>
                            
                            {/* URL Input Section */}
                            <div>
                              <p className="text-sm text-gray-400 mb-2">Add a link to your resume</p>
                              <input
                                type="text"
                                value={resumeLink}
                                onChange={(e) => setResumeLink(e.target.value)}
                                placeholder="Enter resume URL (Google Drive, Dropbox, etc.)"
                                className="w-full px-3 py-2 bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                              />
                              
                              <button
                                onClick={handleResumeUpdate}
                                disabled={!resumeLink || updatingResumeLink}
                                className="w-full mt-3 py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                              >
                                {updatingResumeLink ? 'Updating...' : userDetails?.resumeURL ? 'Update Resume Link' : 'Add Resume Link'}
                              </button>
                              
                              {resumeLinkSuccess && (
                                <div className="mt-2 flex items-center text-green-500 text-xs">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Resume link updated successfully
                                </div>
                              )}
                              
                              {resumeLinkError && (
                                <div className="mt-2 flex items-center text-red-500 text-xs">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  {resumeLinkError}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Links Section */}
                        <div className="bg-white/5 rounded-lg p-4 mb-4">
                          <h4 className="text-white text-sm font-medium mb-2">Professional Links</h4>
                          {userDetails?.linkedin && (
                            <a 
                              href={userDetails.linkedin}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center text-sm text-blue-400 hover:text-blue-300 mb-2"
                            >
                              <Linkedin className="h-4 w-4 mr-2" />
                              LinkedIn Profile
                            </a>
                          )}
                          {userDetails?.portfolio && (
                            <a 
                              href={userDetails.portfolio}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center text-sm text-blue-400 hover:text-blue-300 mb-2"
                            >
                              <Globe className="h-4 w-4 mr-2" />
                              Portfolio Website
                            </a>
                          )}
                          {(!userDetails?.linkedin && !userDetails?.portfolio) && (
                            <p className="text-sm text-gray-400">No professional links added</p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="space-y-2">
                          <button
                            onClick={toggleEditProfile}
                            className="w-full py-2 px-4 flex items-center rounded-lg hover:bg-white/10 transition-colors"
                          >
                            <Edit className="h-5 w-5 mr-3" />
                            <span>Edit Profile</span>
                          </button>
                          <button
                            onClick={handleLogout}
                            className="w-full py-2 px-4 flex items-center rounded-lg hover:bg-white/10 transition-colors"
                          >
                            <LogOut className="h-5 w-5 mr-3" />
                            <span>Logout</span>
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 py-4 w-full">
        <div className="flex border-b border-white/10 mb-6">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 font-medium text-sm transition-colors ${
              activeTab === 'dashboard' 
                ? 'text-white border-b-2 border-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 font-medium text-sm transition-colors flex items-center ${
              activeTab === 'history' 
                ? 'text-white border-b-2 border-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Interview History
            {interviewHistory.length > 0 && (
              <span className="ml-2 bg-white/10 text-white text-xs px-2 py-0.5 rounded-full">
                {interviewHistory.length}
              </span>
            )}
          </button>
        </div>
        
        {/* Dashboard Tab Content */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Welcome Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <h1 className="text-3xl font-bold mb-1">Welcome to your NERV interview</h1>
              <p className="text-gray-400 text-sm mb-4">Let's get you ready for your next technical interview</p>
              
              {/* Resume Upload Box - More compact */}
              <div className="bg-black border border-white/10 rounded-xl p-4 shadow-lg hover:border-white/30 transition-all">
                <h2 className="text-lg font-semibold mb-3 flex items-center">
                  <FileText className="h-4 w-4 mr-2" />
                  Your Resume
                </h2>
                
                {userDetails?.resumeURL ? (
                  <div className="mb-3">
                    <p className="text-gray-400 text-sm mb-1">Your resume is ready for interviews</p>
                    <a 
                      href={userDetails.resumeURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-400 hover:text-blue-300 text-sm"
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      View Resume {userDetails.resumeName && `(${userDetails.resumeName})`}
                    </a>
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm mb-3">Add your resume to enhance your interview experience</p>
                )}
                
                <div className="space-y-3">
                  {/* File Upload Section */}
                  <div className="border border-dashed border-white/20 rounded-lg p-3 hover:border-white/40 transition-all">
                    <label htmlFor="resume-file-input" className="flex flex-col items-center justify-center cursor-pointer">
                      <Upload className="h-5 w-5 mb-1 text-gray-400" />
                      <span className="text-xs font-medium">Upload PDF Resume</span>
                      <span className="text-xs text-gray-500">Max 5MB</span>
                      <input 
                        id="resume-file-input"
                        type="file" 
                        accept=".pdf" 
                        onChange={handleFileChange}
                        className="hidden" 
                      />
                    </label>
                    
                    {file && (
                      <div className="mt-2 flex items-center justify-between bg-white/5 p-1 rounded">
                        <span className="text-xs truncate max-w-[200px]">{file.name}</span>
                        <button 
                          onClick={() => setFile(null)}
                          className="text-gray-400 hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    
                    {file && (
                      <button
                        onClick={handleResumeFileUpload}
                        disabled={uploading}
                        className="w-full mt-2 py-1 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium text-xs"
                      >
                        {uploading ? 'Uploading...' : 'Upload Resume'}
                      </button>
                    )}
                    
                    {uploadError && (
                      <div className="mt-1 flex items-center text-red-500 text-xs">
                        <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                        {uploadError}
                      </div>
                    )}
                    
                    {uploadSuccess && (
                      <div className="mt-1 flex items-center text-green-500 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                        Resume uploaded successfully
                      </div>
                    )}
                  </div>
                  
                  {/* OR Divider */}
                  <div className="flex items-center">
                    <div className="flex-grow border-t border-white/10"></div>
                    <span className="mx-2 text-xs text-gray-500">OR</span>
                    <div className="flex-grow border-t border-white/10"></div>
                  </div>
                  
                  {/* URL Input Section */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Add a link to your resume</p>
                    <input
                      type="text"
                      value={resumeLink}
                      onChange={(e) => setResumeLink(e.target.value)}
                      placeholder="Enter resume URL (Google Drive, Dropbox, etc.)"
                      className="w-full px-2 py-1 text-sm bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                    />
                    
                    <button
                      onClick={handleResumeUpdate}
                      disabled={!resumeLink || updatingResumeLink}
                      className="w-full mt-2 py-1 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium text-xs"
                    >
                      {updatingResumeLink ? 'Updating...' : userDetails?.resumeURL ? 'Update Resume Link' : 'Add Resume Link'}
                    </button>
                    
                    {resumeLinkSuccess && (
                      <div className="mt-1 flex items-center text-green-500 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Resume link updated successfully
                      </div>
                    )}
                    
                    {resumeLinkError && (
                      <div className="mt-1 flex items-center text-red-500 text-xs">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {resumeLinkError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Interview Prep Card */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="bg-black border border-white/10 rounded-xl p-4 shadow-lg hover:border-white/30 transition-all h-fit"
            >
              <div className="flex items-center mb-2">
                <Briefcase className="h-4 w-4 text-white mr-2" />
                <h2 className="text-lg font-semibold">Start Interview</h2>
              </div>
              <p className="text-gray-400 text-xs mb-3">
                Ready to practice? Start a simulated technical interview with our AI interviewer.
              </p>

              <div className="space-y-2 mb-3">
                <div className="flex items-center">
                  <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center mr-2 flex-shrink-0">
                    <span className="text-white text-xs font-medium">1</span>
                  </div>
                  <span className="text-gray-300 text-xs">Answer technical questions in real-time</span>
                </div>
                <div className="flex items-center">
                  <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center mr-2 flex-shrink-0">
                    <span className="text-white text-xs font-medium">2</span>
                  </div>
                  <span className="text-gray-300 text-xs">Receive instant feedback on your responses</span>
                </div>
                <div className="flex items-center">
                  <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center mr-2 flex-shrink-0">
                    <span className="text-white text-xs font-medium">3</span>
                  </div>
                  <span className="text-gray-300 text-xs">Review detailed performance analysis</span>
                </div>
              </div>
              
              {/* Interview Configuration */}
              <div className="border-t border-white/10 pt-3 mb-3">
                <h3 className="text-sm font-medium mb-2">Interview Configuration</h3>
                
                {/* Interview Duration */}
                <div className="mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs text-gray-400">Interview Duration</label>
                    <span className="text-xs text-white/70">{interviewDuration} minutes</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="45"
                    step="5"
                    value={interviewDuration}
                    onChange={(e) => setInterviewDuration(Number(e.target.value))}
                    className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>5 min</span>
                    <span>45 min</span>
                  </div>
                </div>
                
                {/* Difficulty Level */}
                <div className="mb-2">
                  <label className="block text-xs text-gray-400 mb-1">Difficulty Level</label>
                  <select
                    value={difficultyLevel}
                    onChange={(e) => setDifficultyLevel(e.target.value)}
                    className="w-full px-2 py-1 text-sm bg-black/50 border border-white/20 rounded-lg focus:ring-1 focus:ring-white focus:border-white/50 focus:outline-none transition-colors"
                  >
                    <option value="easy">Easy (Entry Level)</option>
                    <option value="medium">Medium (Intermediate)</option>
                    <option value="hard">Hard (Advanced)</option>
                    <option value="expert">Expert (Senior Level)</option>
                  </select>
                </div>
              </div>

              {/* Removed for development
                {showResumeAlert && (
                  <div className="mb-2 p-1 bg-amber-500/10 border border-amber-500/50 rounded-lg flex items-center gap-1 text-amber-500">
                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                    <div className="text-xs">
                      Please upload your resume first to get a personalized interview experience.
                    </div>
                  </div>
                )}
              */}

              <button
                onClick={startInterview}
                className="w-full py-1.5 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all flex items-center justify-center text-xs"
              >
                Start Interview
                <ArrowRight className="ml-1 h-3 w-3" />
              </button>
            </motion.div>

            {/* After the "Quick Actions" section, add the "Improvement Plan" section if available */}
            {latestImprovementPlan && activeTab === 'dashboard' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="bg-black/30 rounded-xl p-6 border border-white/10 mb-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Your Improvement Plan</h3>
                  <span className="text-sm text-white/50">
                    {new Date(latestImprovementPlan.generatedAt).toLocaleDateString()}
                  </span>
                </div>
                
                <p className="text-white/70 mb-4">{latestImprovementPlan.summary}</p>
                
                {latestImprovementPlan.skillGaps && latestImprovementPlan.skillGaps.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium mb-2">Key Skill Gaps:</h4>
                    <div className="flex flex-wrap gap-2">
                      {latestImprovementPlan.skillGaps.slice(0, 5).map((skill: string, index: number) => (
                        <span
                          key={index}
                          className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs border border-amber-500/30"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {latestImprovementPlan.timeline && latestImprovementPlan.timeline.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium mb-2">Next Steps:</h4>
                    <div className="space-y-2">
                      {latestImprovementPlan.timeline.slice(0, 2).map((item: any, index: number) => (
                        <div key={index} className="flex items-start">
                          <div className={`
                            w-3 h-3 rounded-full mt-1 mr-2 flex-shrink-0
                            ${item.priority === 'high' ? 'bg-red-500' : 
                              item.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'}
                          `}></div>
                          <div>
                            <div className="text-white/40 text-xs">{item.duration}</div>
                            <div className="text-white/80 text-sm">{item.task}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <button
                  onClick={() => navigate('/results')}
                  className="mt-2 inline-flex items-center text-indigo-400 hover:text-indigo-300 text-sm font-medium"
                >
                  View full improvement plan
                  <ArrowRight className="ml-1 h-4 w-4" />
                </button>
              </motion.div>
            )}
          </div>
        )}
        
        {/* Interview History Tab Content */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="bg-black border border-white/10 rounded-xl p-6 shadow-lg"
            >
              <div className="flex items-center mb-4">
                <History className="h-5 w-5 text-white mr-2" />
                <h2 className="text-xl font-semibold">Your Interview History</h2>
              </div>
              
              {interviewHistory.length > 0 ? (
                <>
                  <div className="space-y-4 mb-6">
                    {currentInterviews.map((interview, index) => (
                      <motion.div
                        key={interview.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.1 }}
                        onClick={() => viewInterviewResults(interview.id)}
                        className="border border-white/10 rounded-lg p-4 hover:border-white/30 hover:bg-white/5 transition-all cursor-pointer"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center mb-2">
                              <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                              <span className="text-sm text-gray-300">
                                {new Date(interview.timestamp).toLocaleDateString()} at {new Date(interview.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            
                            <h3 className="font-medium mb-2 text-white">
                              Interview #{interviewHistory.length - interviewHistory.indexOf(interview)}
                            </h3>
                            
                            <p className="text-gray-400 text-sm line-clamp-2">
                              {interview.summary ? interview.summary.split('\n')[0] : "Interview completed"}
                            </p>
                            
                            <div className="mt-3 flex items-center text-blue-400 text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View detailed results
                            </div>
                          </div>
                          
                          <button
                            onClick={(e) => deleteInterview(interview.id, e)}
                            className="p-1 text-gray-500 hover:text-red-500 transition-colors"
                            title="Delete interview"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                  
                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center space-x-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="p-1 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      
                      <span className="text-sm">
                        Page {currentPage} of {totalPages}
                      </span>
                      
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="p-1 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-400 mb-4">You haven't completed any interviews yet.</p>
                  <button
                    onClick={() => navigate('/interview')}
                    className="px-4 py-2 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all"
                  >
                    Start Your First Interview
                    <ArrowRight className="ml-2 h-4 w-4 inline" />
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard; 
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, CheckCircle, AlertCircle, ArrowRight, Briefcase } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';

const Dashboard = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [error, setError] = useState('');

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      
      // Check if file is PDF
      if (selectedFile.type !== 'application/pdf') {
        setError('Please upload a PDF file');
        return;
      }
      
      // Check file size (max 5MB)
      if (selectedFile.size > 5 * 1024 * 1024) {
        setError('File size should be less than 5MB');
        return;
      }
      
      setFile(selectedFile);
      setError('');
    }
  };

  // Handle file upload
  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    setError('');
    
    try {
      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Here you would normally upload to Firebase Storage
      // const storageRef = ref(storage, `resumes/${currentUser.uid}/${file.name}`);
      // await uploadBytes(storageRef, file);
      
      setUploadSuccess(true);
    } catch (err) {
      setError('Failed to upload resume. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Start interview
  const startInterview = () => {
    navigate('/interview');
  };

  return (
    <div className="min-h-screen bg-black">
      <div className="max-w-7xl mx-auto px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl font-bold mb-2">Welcome to your NERV interview</h1>
          <p className="text-gray-400 mb-12">Let's get you ready for your next technical interview</p>
        </motion.div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          {/* Resume Upload Card */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-black border border-white/10 rounded-xl p-8 shadow-lg hover:border-white/30 transition-all"
          >
            <div className="flex items-center mb-6">
              <FileText className="h-6 w-6 text-white mr-3" />
              <h2 className="text-xl font-semibold">Resume Upload</h2>
            </div>
            <p className="text-gray-400 mb-6">
              Upload your resume to help us tailor interview questions to your experience
            </p>
            
            {!uploadSuccess ? (
              <>
                <div 
                  className="border-2 border-dashed border-white/20 rounded-lg p-8 mb-6 text-center cursor-pointer hover:border-white/50 transition-colors"
                  onClick={() => document.getElementById('resume-upload')?.click()}
                >
                  <Upload className="h-10 w-10 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-300 mb-2">Drag and drop your resume here or click to browse</p>
                  <p className="text-gray-500 text-sm">PDF only, max 5MB</p>
                  <input 
                    type="file" 
                    id="resume-upload" 
                    className="hidden" 
                    accept=".pdf" 
                    onChange={handleFileChange}
                  />
                </div>
                
                {file && (
                  <div className="flex items-center bg-white/5 p-4 rounded-lg mb-6">
                    <FileText className="h-5 w-5 text-white mr-3" />
                    <span className="text-sm truncate flex-1">{file.name}</span>
                    <span className="text-xs text-gray-400">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                )}
                
                {error && (
                  <div className="flex items-center text-red-500 mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <AlertCircle className="h-5 w-5 mr-2" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}
                
                <button
                  onClick={handleUpload}
                  disabled={!file || uploading}
                  className="w-full py-3 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {uploading ? (
                    <>
                      <div className="animate-spin h-5 w-5 mr-2 border-2 border-current border-t-transparent rounded-full"></div>
                      Uploading...
                    </>
                  ) : (
                    'Upload Resume'
                  )}
                </button>
              </>
            ) : (
              <div className="text-center">
                <div className="bg-green-500/10 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </div>
                <h3 className="text-lg font-medium mb-2">Resume Uploaded!</h3>
                <p className="text-gray-400 mb-4">Your resume has been successfully uploaded.</p>
              </div>
            )}
          </motion.div>
          
          {/* Interview Prep Card */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-black border border-white/10 rounded-xl p-8 shadow-lg hover:border-white/30 transition-all"
          >
            <div className="flex items-center mb-6">
              <Briefcase className="h-6 w-6 text-white mr-3" />
              <h2 className="text-xl font-semibold">Start Interview</h2>
            </div>
            <p className="text-gray-400 mb-6">
              Ready to practice? Start a simulated technical interview with our AI interviewer.
            </p>
            
            <div className="space-y-5 mb-8">
              <div className="flex items-center">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mr-3">
                  <span className="text-white font-medium">1</span>
                </div>
                <span className="text-gray-300">Answer technical questions in real-time</span>
              </div>
              <div className="flex items-center">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mr-3">
                  <span className="text-white font-medium">2</span>
                </div>
                <span className="text-gray-300">Receive instant feedback on your responses</span>
              </div>
              <div className="flex items-center">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mr-3">
                  <span className="text-white font-medium">3</span>
                </div>
                <span className="text-gray-300">Review detailed performance analysis</span>
              </div>
            </div>
            
            <button
              onClick={startInterview}
              className="w-full py-3 bg-white text-black rounded-lg hover:bg-black hover:text-white hover:border hover:border-white transition-all flex items-center justify-center"
            >
              Start Interview
              <ArrowRight className="ml-2 h-5 w-5" />
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard; 